import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { Money } from '../../src/domain/money';
import { FinancialErrorCode } from '../../src/domain/constants/errors';
import { WagerKind, WagerStatus } from '../../src/domain/constants/wager';
import type { WagerCommand } from '../../src/domain/types/wager';
import { newId, parseCommand } from '../../src/application/contracts';
import { childHarness } from '../helpers/process-harness';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { assertReconciled } from '../helpers/reconciliation';

let rt: Runtime;
const walletIds = new Set<string>();

beforeAll(async () => {
  requireTestIsolation();
  rt = await createRuntime();
});

afterAll(async () => {
  if (rt) {
    await rt.workers.stop();
    await rt.db.close(true);
    rt.client.destroy();
  }
});

afterEach(async () => {
  await assertReconciled(rt.queries, walletIds);
  walletIds.clear();
});

async function wallet() {
  const view = await rt.service.openWallet(
    newId(),
    Money.from({ amount: '100.00', currency: 'BRL' }),
    { correlationId: newId() },
  );

  walletIds.add(view.walletId);

  return { walletId: view.walletId, playerId: view.playerId };
}

function command(
  view: { walletId: string; playerId: string },
  kind: WagerKind,
  amount: string,
): WagerCommand {
  return parseCommand(
    {
      ...view,
      providerId: 'heavy-concurrency',
      externalTransactionId: newId(),
      roundId: 'heavy-round',
      gameId: 'heavy-game',
      kind,
      money: { amount, currency: 'BRL' },
    },
    newId(),
  );
}

async function parallel(commands: WagerCommand[], processes: number) {
  const children = Array.from({ length: processes }, () => childHarness('financial'));

  try {
    const ready = await Promise.all(children.map((child) => child.wait('ready')));

    expect(new Set(ready.map((event) => event.pid)).size).toBe(processes);
    expect(new Set(ready.map((event) => event.backendPid)).size).toBe(processes);

    children.forEach((child, index) =>
      child.send({
        type: 'prepare',
        config: { commands: commands.filter((_, i) => i % processes === index) },
      }),
    );
    await Promise.all(children.map((child) => child.wait('armed')));
    children.forEach((child) => child.send({ type: 'execute' }));

    const done = await Promise.all(children.map((child) => child.wait('done')));
    const started = await Promise.all(children.map((child) => child.wait('started')));

    expect(Math.max(...started.map((event) => event.at!))).toBeLessThan(
      Math.min(...done.map((event) => event.at!)),
    );
    expect(await Promise.all(children.map((child) => child.child.exited))).toEqual(
      Array.from({ length: processes }, () => 0),
    );

    return done.flatMap((event) => event.results!);
  } finally {
    children.forEach((child) => child.kill());
  }
}

async function assertJournals(ids: string[]) {
  const walletArray = `{${ids.join(',')}}`;
  const [counts] = await rt.db.em
    .fork()
    .execute<{ journals: string; unbalanced: string; ledger: string }[]>(
      `SELECT
     (SELECT count(*)::text FROM accounting_journals WHERE wallet_id=ANY(?::uuid[])) journals,
     (SELECT count(*)::text FROM wallet_ledger WHERE wallet_id=ANY(?::uuid[])) ledger,
     (SELECT count(*)::text FROM accounting_journals j WHERE j.wallet_id=ANY(?::uuid[])
       AND ((SELECT count(*) FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>2
       OR (SELECT sum(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END)
           FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>0)) unbalanced`,
      [walletArray, walletArray, walletArray],
    );

  expect(counts!.journals).toBe(counts!.ledger);
  expect(counts!.unbalanced).toBe('0');
}

test('six processes apply 180 mixed operations with 360 deliveries and exact per-wallet effects', async () => {
  const views = await Promise.all(Array.from({ length: 6 }, () => wallet()));
  const unique = views.flatMap((view) =>
    Array.from({ length: 10 }, () => [
      command(view, WagerKind.BET, '0.03'),
      command(view, WagerKind.WIN, '0.05'),
      command(view, WagerKind.LOSS, '0.00'),
    ]).flat(),
  );
  // Adjacent duplicates are assigned to different OS processes by the round-robin dispatcher.
  const results = await parallel(
    unique.flatMap((entry) => [entry, entry]),
    6,
  );

  expect(results).toHaveLength(360);
  expect(results.every((result) => result.status === WagerStatus.PROCESSED)).toBe(true);
  expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(180);
  expect(new Set(results.map((result) => result.transactionId)).size).toBe(180);

  for (const view of views) {
    const recon = await rt.queries.reconciliation(view.walletId);

    expect(recon.storedBalance.amount).toBe('100.20');
    expect(recon.calculatedBalance.amount).toBe('100.20');
    expect(recon.checkedEntries).toBe(21);
    expect((await rt.queries.wallet(view.walletId)).version).toBe(21);
  }

  await assertJournals(views.map((view) => view.walletId));
});

test('four processes exhaust a hot wallet with 80 distinct debits and 240 deliveries without overspending', async () => {
  const view = await wallet();
  const unique = Array.from({ length: 80 }, () => command(view, WagerKind.BET, '2.00'));
  const results = await parallel(
    unique.flatMap((entry) => [entry, entry, entry]),
    4,
  );
  const original = results.filter((result) => !result.idempotentReplay);

  expect(results).toHaveLength(240);
  expect(original).toHaveLength(80);
  expect(new Set(results.map((result) => result.transactionId)).size).toBe(80);
  expect(original.filter((result) => result.status === WagerStatus.PROCESSED)).toHaveLength(50);
  expect(original.filter((result) => result.status === WagerStatus.REJECTED)).toHaveLength(30);
  expect(
    original
      .filter((result) => result.status === WagerStatus.REJECTED)
      .every((result) => result.failureCode === FinancialErrorCode.INSUFFICIENT_FUNDS),
  ).toBe(true);

  for (const result of original) {
    const replays = results.filter((entry) => entry.transactionId === result.transactionId);

    expect(replays).toHaveLength(3);
    expect(replays.every((entry) => entry.balance.amount === result.balance.amount)).toBe(true);
    expect(replays.every((entry) => entry.status === result.status)).toBe(true);
  }

  const recon = await rt.queries.reconciliation(view.walletId);

  expect(recon.storedBalance.amount).toBe('0.00');
  expect(recon.calculatedBalance.amount).toBe('0.00');
  expect(recon.checkedEntries).toBe(51);
  expect((await rt.queries.wallet(view.walletId)).version).toBe(51);
  await assertJournals([view.walletId]);
});
