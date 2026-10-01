import { WagerKind, WagerStatus } from '../../src/domain/constants/wager';
import { expect, test } from 'bun:test';
import { unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DemoTable, prizeFor } from '../../demo/table';
import { FileJournal, acquireDemoLock } from '../../demo/journal';
import type { FinancialApi } from '../../demo/types/contracts';
import type { WagerCommand } from '../../src/domain/types/wager';
import { newId } from '../../src/application/contracts';
import { memoryJournal } from '../helpers/demo-journal';

function fixture() {
  const sent: WagerCommand[] = [];
  const journal = memoryJournal();
  let now = 1000;
  let failWin = false;
  const api: FinancialApi = {
    urls: ['http://localhost:3000'],
    openWallet: () =>
      Promise.resolve({
        walletId: newId(),
        playerId: newId(),
        currency: 'BRL',
        balance: { amount: '100.00', currency: 'BRL' },
        version: 1,
      }),
    process: (command) => {
      // This is a port-level ordering check, not a SQL atomicity/concurrency proof.
      expect(
        journal.revisions.at(-1)!.operations.some((op) => op.id === command.idempotencyKey),
      ).toBe(true);
      sent.push(structuredClone(command));

      if (command.kind === WagerKind.WIN && failWin) {
        failWin = false;
        return Promise.reject(new Error('response lost'));
      }

      return Promise.resolve({
        api: 'http://localhost:3000',
        result: {
          transactionId: newId(),
          status: WagerStatus.PROCESSED,
          balance: { amount: '100.00', currency: 'BRL' },
          idempotentReplay: false,
        },
      });
    },
    inspect: () => Promise.reject(new Error('Use real HTTP integration for financial evidence')),
    conflict: () => Promise.resolve(409),
  };
  const table = new DemoTable(api, journal, () => now);

  return {
    table,
    journal,
    sent,
    api,
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    loseWinResponse: () => {
      failWin = true;
    },
  };
}

test.each([
  ['0.01', 101, '0.01'],
  ['25.00', 135, '33.75'],
  ['0.03', 150, '0.04'],
  ['900719925474099.01', 101, '909727124728840.00'],
] as const)(
  'payout of %s at %i hundredths is exactly %s with explicit cent truncation',
  (amount, multiplier, expected) => {
    expect(prizeFor(amount, multiplier)).toBe(expected);
  },
);

test('invalid session/stake and cashout before takeoff do not send financial operations', async () => {
  const f = fixture();

  await Promise.resolve(
    expect(f.table.session(0, 'shared')).rejects.toMatchObject({ code: 'INVALID_SESSION' }),
  );
  await f.table.session(2, 'independent');

  const state = f.table.view().state!;

  expect(new Set(state.peers.map((p) => p.walletId)).size).toBe(2);
  await f.table.addPeers(30);
  expect(f.table.view().state!.peers).toHaveLength(2);
  expect(f.table.view().state!.pendingPeers).toHaveLength(30);
  await Promise.resolve(expect(f.table.place([state.peers[0]!.id], '1.001')).rejects.toThrow());
  expect(f.sent).toHaveLength(0);
  await f.table.place([state.peers[0]!.id], '25.00');
  await Promise.resolve(
    expect(f.table.settle(f.table.view().state!.bets[0]!.id, 'win')).rejects.toMatchObject({
      code: 'CASHOUT_CLOSED',
    }),
  );
  expect(f.sent.map((c) => c.kind)).toEqual([WagerKind.BET]);
});

test('cancel requires the full BET amount and cannot be paid again', async () => {
  const f = fixture();

  await f.table.session(1, 'shared');
  await f.table.place([f.table.view().state!.peers[0]!.id], '25.00');

  const bet = f.table.view().state!.bets[0]!;

  await f.table.settle(bet.id, 'refund');
  expect(f.sent[1]).toMatchObject({
    kind: WagerKind.REFUND,
    money: { amount: '25.00', currency: 'BRL' },
    referenceExternalTransactionId: f.sent[0]!.externalTransactionId,
  });
  await Promise.resolve(
    expect(f.table.settle(bet.id, 'refund')).rejects.toMatchObject({ code: 'CANCEL_CLOSED' }),
  );
  expect(f.sent).toHaveLength(2);
});

test('automatic rounds activate queued BET once and late cashout never debits again', async () => {
  const f = fixture();

  await f.table.session(1, 'independent');
  await f.table.queueBet([f.table.view().state!.peers[0]!.id], '25.00');
  expect(f.sent).toHaveLength(0);
  f.advance(5000);
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  f.advance(3700);
  await f.table.tick();
  expect(f.table.view().state!.roundNumber).toBe(2);
  expect(f.sent.map((c) => c.kind)).toEqual([WagerKind.BET]);
  f.advance(5000);
  await f.table.tick();
  f.advance(10000);

  await Promise.resolve(
    expect(f.table.settle(f.table.view().state!.bets[0]!.id, 'win')).rejects.toMatchObject({
      code: 'CASHOUT_CLOSED',
    }),
  );
  await f.table.tick();
  await f.table.tick();
  expect(f.sent.map((c) => c.kind)).toEqual([WagerKind.BET, WagerKind.LOSS]);
  expect(f.sent[1]!.money.amount).toBe('0.00');
  expect(f.table.view().state!.bets[0]!.status).toBe('lost');
});

test('restart completes the exact planned WIN identity without refunding the same bet', async () => {
  const f = fixture();

  await f.table.session(1, 'shared');
  await f.table.place([f.table.view().state!.peers[0]!.id], '25.00');
  await f.table.takeoff();
  f.advance(1000);
  f.loseWinResponse();
  await f.table.settle(f.table.view().state!.bets[0]!.id, 'win');
  expect(f.table.view().blocked).toBe(true);

  const planned = f.sent[1]!;
  const restarted = new DemoTable(f.api, f.journal, f.clock);

  await restarted.recover();
  expect(f.sent[2]).toEqual(planned);
  expect(f.sent.some((c) => c.kind === WagerKind.REFUND)).toBe(false);
  expect(restarted.view().state!.bets[0]!.status).toBe('cashed');
  expect(restarted.view().blocked).toBe(false);
});

test('restart refunds an open BET before opening another round', async () => {
  const f = fixture();

  await f.table.session(1, 'shared');
  await f.table.place([f.table.view().state!.peers[0]!.id], '25.00');

  const restarted = new DemoTable(f.api, f.journal, f.clock);

  await restarted.recover();
  expect(f.sent.map((c) => c.kind)).toEqual([WagerKind.BET, WagerKind.REFUND]);
  expect(restarted.view().state!.bets[0]!.status).toBe('refunded');
  await restarted.nextRound();
  expect(restarted.view().state!.phase).toBe('betting');
});

test('retry after unavailable restart finishes recovery before freeing another round', async () => {
  const f = fixture();
  await f.table.session(2, 'independent');
  await f.table.place(
    f.table.view().state!.peers.map((p) => p.id),
    '25.00',
  );
  await f.table.takeoff();
  f.advance(1000);
  f.loseWinResponse();
  await f.table.settle(f.table.view().state!.bets[0]!.id, 'win');
  f.loseWinResponse();
  const restarted = new DemoTable(f.api, f.journal, f.clock);
  await restarted.recover();
  expect(restarted.view().blocked).toBe(true);
  await restarted.retry();
  expect(restarted.view().state!.bets.map((bet) => bet.status)).toEqual(['cashed', 'refunded']);
  expect(
    f.sent
      .filter((command) => command.kind === WagerKind.WIN)
      .every((command) => command.idempotencyKey === f.sent[2]!.idempotencyKey),
  ).toBe(true);
  await restarted.nextRound();
  expect(restarted.view().state!.phase).toBe('betting');
});

test('file journal keeps the final parallel revision and rejects a second live coordinator', async () => {
  const f = fixture();

  await f.table.session(1, 'shared');

  const path = resolve(`test-results/decolagem-unit-${newId()}.json`);
  const journal = new FileJournal(path);
  const unlock = await acquireDemoLock(`${path}.lock`);

  try {
    await Promise.resolve(
      expect(acquireDemoLock(`${path}.lock`)).rejects.toMatchObject({ code: 'EEXIST' }),
    );

    const first = f.table.view().state!;
    const last = { ...first, roundNumber: 2 };

    await Promise.all([journal.save(first), journal.save(last)]);
    expect(await journal.load()).toEqual(last);
  } finally {
    await unlock();
    await unlink(path);
  }
});

test('two starters reclaiming a dead process lock leave one coordinator owner', async () => {
  const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await child.exited;
  const path = resolve(`test-results/decolagem-lock-${newId()}.lock`);
  await writeFile(path, JSON.stringify({ pid: child.pid }));
  const results = await Promise.allSettled([acquireDemoLock(path), acquireDemoLock(path)]);
  const owners = results.filter((result) => result.status === 'fulfilled');
  try {
    expect(owners).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  } finally {
    for (const owner of owners) await owner.value();
  }
});
