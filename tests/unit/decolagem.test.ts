import { WagerKind, WagerStatus } from '../../src/domain/constants/wager';
import { expect, test } from 'bun:test';
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DemoTable, prizeFor } from '../../demo/table';
import { FileJournal, acquireDemoLock } from '../../demo/journal';
import type { DemoState, DemoTableOptions, FinancialApi } from '../../demo/types/contracts';
import type { WagerCommand } from '../../src/domain/types/wager';
import { newId } from '../../src/application/contracts';
import { memoryJournal } from '../helpers/demo-journal';

function fixture(options: DemoTableOptions = {}) {
  const sent: WagerCommand[] = [];
  const journal = memoryJournal();
  let walletOpenCount = 0;
  const deterministicPoints = [240, 135, 310];
  let pointIndex = 0;
  const crashPoint =
    options.crashPoint ?? (() => deterministicPoints[pointIndex++ % deterministicPoints.length]!);
  let now = 1000;
  let failWin = false;
  let persistedRevision: DemoState | undefined;
  let persistedIds = new Set<string>();
  const api: FinancialApi = {
    urls: ['http://localhost:3000'],
    openWallet: () => {
      walletOpenCount++;

      return Promise.resolve({
        walletId: newId(),
        playerId: newId(),
        currency: 'BRL',
        balance: { amount: '100.00', currency: 'BRL' },
        version: 1,
      });
    },
    process: (command) => {
      // This is a port-level ordering check, not a SQL atomicity/concurrency proof.
      const revision = journal.revisions.at(-1)!;
      if (persistedRevision !== revision) {
        persistedRevision = revision;
        persistedIds = new Set(revision.operations.map((op) => op.id));
      }
      expect(persistedIds.has(command.idempotencyKey)).toBe(true);
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
  const table = new DemoTable(api, journal, () => now, { ...options, crashPoint });

  return {
    table,
    journal,
    sent,
    api,
    crashPoint,
    get walletOpenCount() {
      return walletOpenCount;
    },
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    loseWinResponse: () => {
      failWin = true;
    },
  };
}

test('financial slots refill before the slowest response while staying within 32 calls', async () => {
  const f = fixture({ initialPeerCount: 96, initialAutoplay: true, peersPerRound: 96 });
  const process = f.api.process.bind(f.api);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  let active = 0;
  let peak = 0;
  f.api.process = async (command) => {
    const first = started++ === 0;
    active++;
    peak = Math.max(peak, active);
    if (first) await gate;
    else await Bun.sleep(1);
    const result = await process(command);
    active--;
    return result;
  };
  const preparing = f.table.recover();
  while (started < 96) await Bun.sleep(1);
  expect(peak).toBe(32);
  expect(f.table.dashboardView().state!.bettingEndsAt).toBeUndefined();
  release();
  await preparing;
  expect(f.table.dashboardView().roundSummary.bets).toBe(96);
  expect(f.table.dashboardView().roundTiming).toEqual({
    countdownMilliseconds: 3000,
    resultMilliseconds: 1500,
  });
});

test('a fixed admission window starts flight on its persisted deadline with independent wallets', async () => {
  const f = fixture({ initialPeerCount: 7, initialAutoplay: true, bettingPolicy: 'deadline' });
  await f.table.recover();
  await f.table.drain();
  const state = f.table.view().state!;
  expect(new Set(state.peers.map((peer) => peer.walletId)).size).toBe(7);
  expect(state.admissionDeadlineAt).toBe(6000);
  expect(f.table.dashboardView().roundSummary.bets).toBe(7);
  f.advance(4999);
  await f.table.tick();
  expect(f.table.view().state!.phase).toBe('betting');
  f.advance(1);
  await f.table.tick();
  expect(f.table.view().state).toMatchObject({ phase: 'flying', startedAt: 6000 });
  f.advance(10000);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 7,
    cashed: 4,
    lost: 3,
    expired: 0,
  });
});

test('deadline flight advances during slow BETs and never sends expired admission intents', async () => {
  const f = fixture({ initialPeerCount: 96, initialAutoplay: true, bettingPolicy: 'deadline' });
  const process = f.api.process.bind(f.api);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  f.api.process = async (command) => {
    if (command.kind === WagerKind.BET) {
      started++;
      await gate;
    }
    return process(command);
  };
  await f.table.recover();
  expect(started).toBe(32);
  f.advance(5000);
  await f.table.tick();
  expect(f.table.view().state).toMatchObject({ phase: 'flying', startedAt: 6000 });
  expect(f.table.dashboardView().pendingOperationCount).toBe(96);
  release();
  await f.table.drain();
  expect(started).toBe(32);
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 0,
    confirming: 0,
    expired: 96,
    refunding: 0,
  });
  const state = f.table.view().state!;
  expect(state.operations.filter((op) => op.expiredBeforeSend)).toHaveLength(64);
  expect(state.operations.filter((op) => op.effect === 'refund')).toHaveLength(32);
  expect(state.bets.filter((bet) => bet.status === 'refunded')).toHaveLength(32);
  f.advance(10000);
  await f.table.tick();
  expect(
    f.sent.some((command) => command.kind === WagerKind.WIN || command.kind === WagerKind.LOSS),
  ).toBe(false);
  const sentCount = f.sent.length;
  const restarted = new DemoTable(f.api, f.journal, f.clock);
  await restarted.recover();
  expect(f.sent).toHaveLength(sentCount);
  expect(restarted.view().blocked).toBe(false);
});

test('deadline admission rotates the first dispatch after a partial round to avoid fixed-order starvation', async () => {
  const f = fixture({ initialPeerCount: 64, initialAutoplay: true, bettingPolicy: 'deadline' });
  const process = f.api.process.bind(f.api);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.api.process = async (command) => {
    if (command.kind === WagerKind.BET) await gate;
    return process(command);
  };
  await f.table.recover();
  f.advance(5000);
  await f.table.tick();
  release();
  await f.table.drain();
  expect(f.table.view().state!.admissionCursor).toBe(32);
  f.advance(10000);
  await f.table.tick();
  const before = f.sent.length;
  await f.table.nextRound();
  await f.table.drain();
  expect(f.sent[before]!.walletId).toBe(f.table.view().state!.peers[32]!.walletId);
});

test('an uncertain BET is retried with its original key and refunded without extending the window', async () => {
  const f = fixture({ initialPeerCount: 1, initialAutoplay: true, bettingPolicy: 'deadline' });
  const process = f.api.process.bind(f.api);
  let lose = true;
  f.api.process = async (command) => {
    const result = await process(command);
    if (command.kind === WagerKind.BET && lose) {
      lose = false;
      throw new Error('BET response lost');
    }
    return result;
  };
  await f.table.recover();
  await f.table.drain();
  const opening = f.sent[0]!;
  expect(f.table.view().blocked).toBe(true);
  f.advance(5000);
  await f.table.tick();
  expect(f.table.view().state!.phase).toBe('flying');
  await f.table.retry();
  expect(f.sent[1]).toEqual(opening);
  expect(f.sent[2]).toMatchObject({
    kind: WagerKind.REFUND,
    referenceExternalTransactionId: opening.externalTransactionId,
    money: opening.money,
  });
  expect(f.table.view().state!.admissionDeadlineAt).toBe(6000);
  expect(f.table.dashboardView().roundSummary).toMatchObject({ bets: 0, expired: 1, refunding: 0 });
});

test('a lost late REFUND response is recovered with its saved identity before another round', async () => {
  const f = fixture({ initialPeerCount: 1, initialAutoplay: true, bettingPolicy: 'deadline' });
  const process = f.api.process.bind(f.api);
  let lose = true;
  f.api.process = async (command) => {
    if (command.kind === WagerKind.BET) f.advance(5000);
    const result = await process(command);
    if (command.kind === WagerKind.REFUND && lose) {
      lose = false;
      throw new Error('REFUND response lost');
    }
    return result;
  };
  await f.table.recover();
  await f.table.drain();
  expect(f.table.dashboardView().roundSummary).toMatchObject({ bets: 0, expired: 1, refunding: 1 });
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  // Bun awaits rejects at runtime although this matcher is typed void.
  // eslint-disable-next-line @typescript-eslint/await-thenable
  await expect(f.table.nextRound()).rejects.toThrow('RETRY_PENDING_OPERATION');
  const refund = f.sent[1]!;
  const restarted = new DemoTable(f.api, f.journal, f.clock);
  await restarted.recover();
  expect(f.sent[2]).toEqual(refund);
  expect(restarted.view().state!.operations.filter((op) => op.effect === 'refund')).toHaveLength(1);
  expect(restarted.view().state!.bets[0]!.status).toBe('refunded');
  expect(restarted.view().blocked).toBe(false);
});

test('a terminal late REFUND rejection remains visible and cannot be hidden by retry or another round', async () => {
  const f = fixture({ initialPeerCount: 1, initialAutoplay: true, bettingPolicy: 'deadline' });
  const process = f.api.process.bind(f.api);
  f.api.process = async (command) => {
    if (command.kind === WagerKind.BET) f.advance(5000);
    const response = await process(command);
    return command.kind === WagerKind.REFUND
      ? { ...response, result: { ...response.result, status: WagerStatus.REJECTED } }
      : response;
  };
  await f.table.recover();
  await f.table.drain();
  const error = f.table.dashboardView().operationError;
  expect(error).toContain('Estorno tardio recusado');
  expect(f.table.view().blocked).toBe(true);
  await f.table.retry();
  expect(f.table.dashboardView().operationError).toBe(error);
  expect(f.sent.filter((command) => command.kind === WagerKind.REFUND)).toHaveLength(1);
});

test('admission, reached cashouts and late refunds share the same 32 financial slots', async () => {
  const f = fixture({ initialPeerCount: 40, initialAutoplay: true, bettingPolicy: 'deadline' });
  const process = f.api.process.bind(f.api);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let bets = 0;
  let active = 0;
  let peak = 0;
  f.api.process = async (command) => {
    active++;
    peak = Math.max(peak, active);
    if (command.kind === WagerKind.BET && bets++ > 0) await gate;
    const response = await process(command);
    active--;
    return response;
  };
  await f.table.recover();
  while (f.table.dashboardView().roundSummary.bets !== 1) await Bun.sleep(1);
  f.advance(5000);
  await f.table.tick();
  f.advance(10000);
  const closing = f.table.tick();
  await Bun.sleep(1);
  expect(f.table.view().state!.phase).toBe('crashed');
  expect(peak).toBe(32);
  release();
  await closing;
  await f.table.drain();
  await f.table.tick();
  expect(peak).toBe(32);
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 1,
    cashed: 1,
    expired: 39,
    refunding: 0,
  });
});

test('an uncertain manual cashout cannot produce an automatic WIN or LOSS for the same bet', async () => {
  const f = fixture({ initialPeerCount: 1, initialAutoplay: true, bettingPolicy: 'deadline' });
  await f.table.recover();
  await f.table.drain();
  f.advance(5000);
  await f.table.tick();
  f.advance(1100);
  f.loseWinResponse();
  await f.table.settle(f.table.view().state!.bets[0]!.id, 'win');
  f.advance(10000);
  await f.table.tick();
  expect(f.sent.filter((command) => command.kind === WagerKind.WIN)).toHaveLength(1);
  expect(f.sent.some((command) => command.kind === WagerKind.LOSS)).toBe(false);
  await f.table.retry();
  expect(f.sent[2]).toEqual(f.sent[1]);
  expect(f.table.dashboardView().roundSummary).toMatchObject({ cashed: 1, lost: 0 });
});

test('window rounds preserve manual reservation priority over autoplay', async () => {
  const f = fixture({ initialPeerCount: 2, initialAutoplay: true, bettingPolicy: 'deadline' });
  await f.table.recover();
  await f.table.drain();
  const peer = f.table.view().state!.peers[0]!;
  await f.table.queueBet([peer.id], '25.00');
  f.advance(5000);
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  await f.table.drain();
  const state = f.table.view().state!;
  const bets = state.bets.filter((bet) => bet.roundId === state.roundId);
  expect(bets).toHaveLength(2);
  expect(bets.find((bet) => bet.peerId === peer.id)!.amount).toBe('25.00');
  expect(state.admissionDeadlineAt).toBe(f.clock() + 5000);
});

test('continuous play opens 8000 independent peers and places only the first group', async () => {
  const f = fixture({ initialPeerCount: 8000, initialAutoplay: true, peersPerRound: 128 });

  await f.table.recover();
  const state = f.table.view().state!;
  expect(state.peers).toHaveLength(8000);
  expect(new Set(state.peers.map((peer) => peer.walletId)).size).toBe(8000);
  expect(state.bets).toHaveLength(128);
  expect(f.sent).toHaveLength(128);
  expect(state.autoplay).toMatchObject({ enabled: true, nextPeerIndex: 128, cycles: 0 });
  expect(f.table.dashboardView().state!.peers).toHaveLength(100);
});

test('all 8000 peers participate every round and the countdown waits for slow confirmations', async () => {
  const f = fixture({ initialPeerCount: 8000, initialAutoplay: true });
  const process = f.api.process.bind(f.api);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.api.process = async (command) => {
    await gate;
    return process(command);
  };

  const preparing = f.table.recover();
  while (f.table.dashboardView().roundSummary.planned !== 8000) await Bun.sleep(1);
  f.advance(60000);
  const pending = f.table.dashboardView();
  expect(pending.roundSummary).toMatchObject({ planned: 8000, confirming: 8000, bets: 0 });
  expect(pending.pendingOperationCount).toBe(8000);
  expect(pending.operationError).toBeUndefined();
  expect(pending.state!.phase).toBe('betting');
  expect(pending.state!.bettingEndsAt).toBeUndefined();
  release();
  await preparing;
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    planned: 8000,
    confirming: 0,
    bets: 8000,
    wagered: '8000.00',
  });
  const state = f.table.view().state!;
  expect(new Set(state.peers.map((peer) => peer.walletId)).size).toBe(8000);
  expect(state.bettingEndsAt).toBe(f.clock() + 3000);
  expect(state.autoplay).toMatchObject({ peersPerRound: 8000, nextPeerIndex: 0, cycles: 1 });
  f.advance(2999);
  await f.table.tick();
  expect(f.table.view().state!.phase).toBe('betting');
  f.advance(1);
  await f.table.tick();
  expect(f.table.view().state!.phase).toBe('flying');
  f.advance(10000);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 8000,
    active: 0,
    cashed: 4572,
    lost: 3428,
    paid: '7658.10',
  });
  f.advance(1500);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary.bets).toBe(8000);
  expect(f.table.view().state!.autoplay!.cycles).toBe(2);
  expect(f.table.dashboardView().state!.peers).toHaveLength(100);
});

test('a slow first cashout crossing the crash still pays every reached automatic target', async () => {
  const f = fixture({ peersPerRound: 7 });
  const process = f.api.process.bind(f.api);
  let delayed = false;
  f.api.process = async (command) => {
    const result = await process(command);
    if (command.kind === WagerKind.WIN && !delayed) {
      delayed = true;
      f.advance(10000);
    }
    return result;
  };
  await f.table.session(7, 'independent', true);
  await f.table.takeoff();
  f.advance(1100);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 7,
    active: 0,
    cashed: 4,
    lost: 3,
    paid: '6.70',
  });
  expect(
    f.sent
      .filter((command) => command.kind === WagerKind.WIN)
      .map((command) => command.money.amount),
  ).toEqual(['1.20', '1.50', '1.80', '2.20']);
  expect(f.sent.findIndex((command) => command.kind === WagerKind.LOSS)).toBe(11);
});

test('an uncertain catchup WIN blocks LOSS until its original identity is confirmed', async () => {
  const f = fixture({ peersPerRound: 7 });
  const process = f.api.process.bind(f.api);
  let delayed = false;
  let uncertain = true;
  f.api.process = async (command) => {
    const result = await process(command);
    if (command.kind === WagerKind.WIN && !delayed) {
      delayed = true;
      f.advance(10000);
    }
    if (command.kind === WagerKind.WIN && command.money.amount === '1.50' && uncertain) {
      uncertain = false;
      throw new Error('catchup WIN response lost');
    }
    return result;
  };
  await f.table.session(7, 'independent', true);
  await f.table.takeoff();
  f.advance(1100);
  await f.table.tick();
  expect(f.table.view().blocked).toBe(true);
  expect(f.sent.some((command) => command.kind === WagerKind.LOSS)).toBe(false);
  const identity = f.sent.find((command) => command.money.amount === '1.50')!.idempotencyKey;
  await f.table.retry();
  await f.table.tick();
  expect(f.sent.filter((command) => command.idempotencyKey === identity)).toHaveLength(2);
  expect(f.table.dashboardView().roundSummary).toMatchObject({ cashed: 4, lost: 3, paid: '6.70' });
});

test('an uncertain BET pauses the complete group and retry starts a fresh countdown', async () => {
  const f = fixture({ peersPerRound: 160 });
  const process = f.api.process.bind(f.api);
  let first = true;
  f.api.process = async (command) => {
    const result = await process(command);
    if (first && command.kind === WagerKind.BET) {
      first = false;
      throw new Error('BET response lost');
    }
    return result;
  };
  await f.table.session(160, 'independent', true);
  const pending = f.table.dashboardView();
  expect(pending.roundSummary).toMatchObject({ planned: 160, confirming: 129, bets: 31 });
  expect(pending.operationError).toBe('BET response lost');
  expect(pending.state!.bettingEndsAt).toBeUndefined();
  const identities = f.table.view().state!.operations.map((operation) => operation.id);
  f.advance(60000);
  await f.table.tick();
  expect(f.table.view().state!.phase).toBe('betting');
  await f.table.retry();
  expect(f.table.view().state!.operations.map((operation) => operation.id)).toEqual(identities);
  expect(f.table.dashboardView().roundSummary).toMatchObject({ bets: 160, confirming: 0 });
  expect(f.table.view().state!.bettingEndsAt).toBe(f.clock() + 3000);
  expect(f.sent).toHaveLength(161);
});

test('changing the future round group preserves the session and validates before mutation', async () => {
  const f = fixture({ peersPerRound: 2 });
  await f.table.session(7, 'independent', true);
  const before = f.table.view().state!;
  for (const invalid of [0, -1, 8001, 1.5, NaN]) {
    // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun reject matchers are asynchronous at runtime.
    await expect(f.table.setAutoplay(false, invalid)).rejects.toThrow();
    expect(f.table.view().state!.autoplay).toEqual(before.autoplay);
  }
  await f.table.setAutoplay(true, 8000);
  expect(f.table.view().state!.sessionId).toBe(before.sessionId);
  expect(f.table.view().state!.peers).toEqual(before.peers);
  expect(f.table.view().state!.autoplay!.nextPeerIndex).toBe(2);
  expect(f.table.dashboardView().roundSummary.bets).toBe(2);
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  expect(f.table.dashboardView().roundSummary.bets).toBe(7);
});

test('continuous rounds rotate every peer, settle overdue targets and compact completed history', async () => {
  const f = fixture({ peersPerRound: 2 });
  const roundCount = 12;
  await f.table.session(5, 'independent', true);
  const peers = f.table.view().state!.peers;
  const groups: string[][] = [];

  for (let round = 0; round < roundCount; round++) {
    const state = f.table.view().state!;
    groups.push(state.bets.filter((bet) => bet.roundId === state.roundId).map((bet) => bet.peerId));
    await f.table.takeoff();
    f.advance(10000);
    await f.table.tick();
    await f.table.tick();
    expect(f.table.view().blocked).toBe(false);
    if (round < roundCount - 1) await f.table.nextRound();
  }

  expect(groups.slice(0, 3).flat()).toEqual([...peers.map((peer) => peer.id), peers[0]!.id]);
  for (const group of groups) expect(new Set(group).size).toBe(group.length);
  expect(f.sent.filter((command) => command.kind === WagerKind.BET)).toHaveLength(24);
  const state = f.table.view().state!;
  // Keep complete bets for the 30-command replay window plus the current round.
  expect(state.bets).toHaveLength(18);
  expect(state.operations).toHaveLength(36);
  expect(state.history).toMatchObject({ operationCount: 12, completedOperationCount: 12 });
  const dashboard = f.table.dashboardView();
  expect(dashboard.operationCount).toBe(48);
  expect(dashboard.completedOperationCount).toBe(48);
  expect(dashboard.apiOperationCounts['http://localhost:3000']).toBe(48);
  expect(dashboard.state!.operations.map((operation) => operation.id)).toEqual(
    f.sent.slice(-30).map((command) => command.idempotencyKey),
  );
  expect(dashboard.sessionSummary).toEqual({ cashed: 10, lost: 14, paid: '15.40', complete: true });
  expect(state.autoplay).toMatchObject({ nextPeerIndex: 4, cycles: 4 });
  expect(f.sent.filter((command) => command.kind === WagerKind.WIN)).toHaveLength(10);
  expect(f.sent.filter((command) => command.kind === WagerKind.LOSS)).toHaveLength(14);
});

test('pausing future bets still settles active bets and resume retains the rotation cursor', async () => {
  const f = fixture({ peersPerRound: 2 });
  await f.table.session(4, 'independent', true);
  await f.table.setAutoplay(false);
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  expect(f.table.view().state!.bets.every((bet) => bet.status === 'cashed')).toBe(true);
  await f.table.nextRound();
  expect(f.sent.filter((command) => command.kind === WagerKind.BET)).toHaveLength(2);
  await f.table.setAutoplay(true);
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  expect(f.table.view().state!.autoplay!.nextPeerIndex).toBe(0);
  expect(f.sent.filter((command) => command.kind === WagerKind.BET)).toHaveLength(4);
});

test('automatic WIN with a lost response retries its durable identity before LOSS or another round', async () => {
  const f = fixture();
  await f.table.session(7, 'independent', true);
  await f.table.takeoff();
  f.advance(10000);
  f.loseWinResponse();
  await f.table.tick();
  expect(f.table.view().blocked).toBe(true);
  expect(f.sent.filter((command) => command.kind === WagerKind.LOSS)).toHaveLength(0);
  const uncertain = f.table.view().state!.operations.find((operation) => operation.error)!;
  await f.table.tick();
  expect(f.sent).toHaveLength(11);
  await f.table.retry();
  expect(f.sent.at(-1)).toEqual(uncertain.command);
  await f.table.tick();
  expect(f.table.view().blocked).toBe(false);
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 7,
    cashed: 4,
    lost: 3,
    wagered: '7.00',
    paid: '6.70',
  });
});

test('manual reservations take priority and shared-wallet peers can play continuously from one wallet', async () => {
  const f = fixture({ peersPerRound: 2 });
  await f.table.session(3, 'independent');
  const peer = f.table.view().state!.peers[0]!;
  await f.table.queueBet([peer.id], '2.00');
  await f.table.setAutoplay(true);
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  const bets = f.table.view().state!.bets;
  expect(bets.filter((bet) => bet.peerId === peer.id)).toHaveLength(1);
  expect(bets.find((bet) => bet.peerId === peer.id)!.amount).toBe('2.00');
  expect(bets).toHaveLength(2);

  const shared = fixture();
  await shared.table.session(2, 'shared', true);
  const state = shared.table.view().state!;
  expect(new Set(state.peers.map((peer) => peer.walletId)).size).toBe(1);
  expect(new Set(state.peers.map((peer) => peer.playerId)).size).toBe(1);
  expect(shared.sent.map((command) => command.kind)).toEqual([WagerKind.BET, WagerKind.BET]);
  expect(new Set(shared.sent.map((command) => command.walletId)).size).toBe(1);
  expect(state.autoplay).toMatchObject({ enabled: true, peersPerRound: 8000 });
});

test('a shared wallet depleted by the round pauses autoplay without opening replacement wallets', async () => {
  const f = fixture({ crashPoint: () => 310, renewExhaustedWallets: true });
  const process = f.api.process.bind(f.api);
  f.api.process = async (command) => {
    const response = await process(command);

    return {
      ...response,
      result: {
        ...response.result,
        status: WagerStatus.REJECTED,
        balance: { amount: '0.00', currency: 'BRL' },
        failureCode: 'INSUFFICIENT_FUNDS',
      },
    };
  };

  await f.table.session(3, 'shared', true);
  const state = f.table.view().state!;

  expect(f.sent).toHaveLength(3);
  expect(state.autoplay).toMatchObject({ enabled: false, pauseReason: 'wallet_depleted' });
  expect(f.walletOpenCount).toBe(1);
  expect(
    state.peers.map((peer) => peer.walletId).every((id) => id === state.peers[0]!.walletId),
  ).toBe(true);
  expect(f.table.dashboardView().state!.bettingEndsAt).toBeUndefined();
  await f.table.tick();
  expect(f.sent).toHaveLength(3);
});

test('a peer without funds sits out later rounds without a replacement wallet or credit', async () => {
  const f = fixture({ peersPerRound: 1 });
  const process = f.api.process.bind(f.api);
  f.api.process = async (command) => {
    const response = await process(command);
    return {
      ...response,
      result: {
        ...response.result,
        status: WagerStatus.REJECTED,
        balance: { amount: '0.00', currency: 'BRL' },
        failureCode: 'INSUFFICIENT_FUNDS',
      },
    };
  };
  await f.table.session(1, 'independent', true);
  const peer = f.table.view().state!.peers[0]!;
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  expect(f.sent).toHaveLength(1);
  expect(f.table.view().state!.peers[0]!.walletId).toBe(peer.walletId);
  expect(f.table.dashboardView().roundSummary.bets).toBe(0);
});

test('restart preserves autoplay configuration, cursor and accumulated counts after compaction', async () => {
  const f = fixture({ peersPerRound: 2 });
  await f.table.session(5, 'independent', true);
  for (let round = 0; round < 12; round++) {
    await f.table.takeoff();
    f.advance(10000);
    await f.table.tick();
    if (round < 11) await f.table.nextRound();
  }
  const before = f.table.view().state!;
  const dashboard = f.table.dashboardView();
  expect(before.history!.operationCount).toBeGreaterThan(0);
  const sentBeforeRecovery = f.sent.length;
  const restarted = new DemoTable(f.api, f.journal, f.clock, {
    initialPeerCount: 8000,
    initialAutoplay: false,
    crashPoint: f.crashPoint,
  });
  await restarted.recover();
  expect(restarted.view().state!.peers).toEqual(before.peers);
  expect(restarted.view().state!.autoplay).toEqual(before.autoplay);
  expect(restarted.view().state!.history).toEqual(before.history);
  expect(restarted.dashboardView().sessionSummary).toEqual(dashboard.sessionSummary);
  expect(restarted.dashboardView().completedOperationCount).toBe(48);
  expect(restarted.dashboardView().state!.operations).toEqual(dashboard.state!.operations);
  expect(f.sent).toHaveLength(sentBeforeRecovery);
  const replay = dashboard.state!.operations[0]!;
  await restarted.repeat(replay.id);
  expect(f.sent.at(-1)).toEqual(replay.command);
  expect(f.sent).toHaveLength(sentBeforeRecovery + 1);
  expect(restarted.dashboardView().completedOperationCount).toBe(48);
  expect(restarted.dashboardView().sessionSummary).toEqual(dashboard.sessionSummary);
  await restarted.nextRound();
  expect(restarted.view().state!.autoplay!.nextPeerIndex).toBe(1);
  expect(restarted.dashboardView().completedOperationCount).toBe(50);
  expect(restarted.dashboardView().sessionSummary).toEqual(dashboard.sessionSummary);
});

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
  f.advance(3000);
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  f.advance(1500);
  await f.table.tick();
  expect(f.table.view().state!.roundNumber).toBe(2);
  expect(f.sent.map((c) => c.kind)).toEqual([WagerKind.BET]);
  f.advance(3000);
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
  const restarted = new DemoTable(f.api, f.journal, f.clock, { crashPoint: f.crashPoint });

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

  const restarted = new DemoTable(f.api, f.journal, f.clock, { crashPoint: f.crashPoint });

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
  const restarted = new DemoTable(f.api, f.journal, f.clock, { crashPoint: f.crashPoint });
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

test('file journal preserves a corrupt revision and refuses to create a replacement session', async () => {
  const path = resolve(`test-results/decolagem-corrupt-${newId()}.json`);
  const bytes = Buffer.alloc(1024);
  await writeFile(path, bytes);
  try {
    await Promise.resolve(
      expect(new FileJournal(path).load()).rejects.toThrow('preserve o arquivo'),
    );
    expect(await readFile(path)).toEqual(bytes);
    await Promise.resolve(
      expect(new DemoTable(fixture().api, new FileJournal(path)).recover()).rejects.toThrow(
        'preserve o arquivo',
      ),
    );
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    await unlink(path);
  }
});

test('file journal keeps the committed revision after a failed write and allows a durable retry', async () => {
  const f = fixture();
  await f.table.session(1, 'shared');
  const path = resolve(`test-results/decolagem-write-failure-${newId()}.json`);
  const journal = new FileJournal(path);
  const first = f.table.view().state!;
  try {
    await journal.save(first);
    await mkdir(`${path}.next`);
    await Promise.resolve(expect(journal.save({ ...first, roundNumber: 2 })).rejects.toThrow());
    expect(await journal.load()).toEqual(first);
    await rmdir(`${path}.next`);
    const last = { ...first, roundNumber: 3 };
    await journal.save(last);
    expect(await journal.load()).toEqual(last);
  } finally {
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

test('two starters reclaim a live PID reused by a different process and leave one coordinator owner', async () => {
  const path = resolve(`test-results/decolagem-reused-pid-${newId()}.lock`);
  const identity = { bootId: 'current-boot', startTime: 'current-start' };
  await writeFile(
    path,
    JSON.stringify({
      pid: process.pid,
      bootId: 'current-boot',
      startTime: 'previous-start',
      ownerToken: 'previous-owner',
    }),
  );
  const identifyProcess = (pid: number) =>
    Promise.resolve(pid === process.pid ? identity : undefined);
  const results = await Promise.allSettled([
    acquireDemoLock(path, identifyProcess),
    acquireDemoLock(path, identifyProcess),
  ]);
  const owners = results.filter((result) => result.status === 'fulfilled');

  try {
    expect(owners).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  } finally {
    for (const owner of owners) await owner.value();
    await unlink(path).catch(() => undefined);
  }
});
