import { WagerKind, WagerStatus } from '../../src/domain/constants/wager';
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { createRuntime } from '../../src/infrastructure/runtime';
import { createHttpApp } from '../../src/adapters/http';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { assertReconciled } from '../helpers/reconciliation';
import { memoryJournal } from '../helpers/demo-journal';
import { HttpFinancialApi } from '../../demo/api';
import { DemoTable } from '../../demo/table';
import { startDemoServer } from '../../demo/server';
import type { FinancialApi } from '../../demo/types/contracts';

const apps: Awaited<ReturnType<typeof createHttpApp>>[] = [];
const runtimes: Awaited<ReturnType<typeof createRuntime>>[] = [];
const walletIds = new Set<string>();
let api: HttpFinancialApi;

beforeAll(async () => {
  requireTestIsolation();
  for (let i = 0; i < 3; i++) {
    const runtime = await createRuntime();
    runtimes.push(runtime);
    const app = await createHttpApp(runtime);
    apps.push(app);
    await app.listen(0, '127.0.0.1');
  }
  api = new HttpFinancialApi(await Promise.all(apps.map((app) => app.getUrl())));
});
afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});
afterEach(async () => {
  await assertReconciled(runtimes[0]!.queries, walletIds);
  walletIds.clear();
});

async function fixture(
  count: number,
  mode: 'shared' | 'independent',
  financial: FinancialApi = api,
  autoplay = false,
) {
  const journal = memoryJournal();
  let now = 1000;
  const points = [240, 135, 310];
  let pointIndex = 0;
  const crashPoint = () => points[pointIndex++ % points.length]!;
  const clock = () => now;
  const table = new DemoTable(financial, journal, clock, { crashPoint });
  await table.session(count, mode, autoplay);
  for (const peer of table.view().state!.peers) walletIds.add(peer.walletId);
  return {
    table,
    journal,
    clock,
    crashPoint,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('8000 peers confirm and settle a complete round through three real HTTP APIs', async () => {
  const f = await fixture(8000, 'independent');
  await f.table.setAutoplay(true, 8000);
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  const started = performance.now();
  await f.table.nextRound();
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    planned: 8000,
    confirming: 0,
    bets: 8000,
    active: 8000,
    wagered: '8000.00',
  });
  expect(f.table.view().state!.bettingEndsAt).toBe(f.clock() + 3000);
  f.advance(2999);
  await f.table.tick();
  expect(f.table.view().state!.phase).toBe('betting');
  f.advance(1);
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 8000,
    active: 0,
    cashed: 1142,
    lost: 6858,
    paid: '1370.40',
  });
  const state = f.table.view().state!;
  expect(new Set(state.operations.map((operation) => operation.api)).size).toBe(3);
  expect(state.operations).toHaveLength(16000);
  expect(
    state.operations.every((operation) => operation.result?.status === WagerStatus.PROCESSED),
  ).toBe(true);
  expect(f.table.view().blocked).toBe(false);
  for (const index of [0, 6, 7999]) {
    const evidence = await f.table.evidence(state.peers[index]!.id);
    expect(evidence.wallet.balance.amount).toBe(index === 6 ? '100.20' : '99.00');
    expect(evidence.reconciliation.difference.amount).toBe('0.00');
  }
  console.log(
    `8000-peer financial round confirmed and settled in ${Math.round(performance.now() - started)} ms`,
  );
}, 600000);

test('slow real WIN responses crossing the crash still settle every reached target before LOSS', async () => {
  let now = 1000;
  let delayed = false;
  const financial: FinancialApi = {
    urls: api.urls,
    openWallet: () => api.openWallet(),
    process: async (command) => {
      const response = await api.process(command);
      if (command.kind === WagerKind.WIN && !delayed) {
        delayed = true;
        now += 10000;
      }
      return response;
    },
    inspect: (walletId, cursor) => api.inspect(walletId, cursor),
    conflict: (command) => api.conflict(command),
  };
  const points = [240, 135, 310];
  let pointIndex = 0;
  const table = new DemoTable(financial, memoryJournal(), () => now, {
    peersPerRound: 7,
    crashPoint: () => points[pointIndex++ % points.length]!,
  });
  await table.session(7, 'independent', true);
  const peers = table.view().state!.peers;
  for (const peer of peers) walletIds.add(peer.walletId);
  await table.takeoff();
  now += 1100;
  await table.tick();
  expect(table.dashboardView().roundSummary).toMatchObject({ cashed: 4, lost: 3, paid: '6.70' });
  for (const [index, expected] of [
    '100.20',
    '100.50',
    '100.80',
    '101.20',
    '99.00',
    '99.00',
    '99.00',
  ].entries()) {
    const evidence = await table.evidence(peers[index]!.id);
    expect(evidence.wallet.balance.amount).toBe(expected);
    expect(evidence.ledger.items).toHaveLength(index < 4 ? 3 : 2);
    expect(evidence.reconciliation.difference.amount).toBe('0.00');
  }
});

test('six shared-wallet peers contend through three real HTTP APIs with one 80.00 debit', async () => {
  const { table } = await fixture(6, 'shared');
  const peers = table.view().state!.peers;
  await table.place(
    peers.map((p) => p.id),
    '80.00',
  );
  const state = table.view().state!;
  expect(state.operations.filter((op) => op.result?.status === WagerStatus.PROCESSED)).toHaveLength(
    1,
  );
  expect(state.operations.filter((op) => op.result?.status === WagerStatus.REJECTED)).toHaveLength(
    5,
  );
  expect(new Set(state.operations.map((op) => op.api)).size).toBe(3);
  const evidence = await table.evidence(peers[0]!.id);
  expect(evidence.wallet.balance.amount).toBe('20.00');
  expect(evidence.ledger.items).toHaveLength(2);
  expect(evidence.reconciliation.consistent).toBe(true);
});

test('continuous rounds settle exact automatic prizes and losses through three real APIs', async () => {
  const f = await fixture(7, 'independent');
  const peers = f.table.view().state!.peers;
  await f.table.setAutoplay(true);
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();

  // Round two crashes at 1.35: only the peer assigned 1.20 can cash out.
  expect(f.table.dashboardView().roundSummary).toMatchObject({
    bets: 7,
    cashed: 1,
    lost: 6,
    wagered: '7.00',
    paid: '1.20',
  });
  for (const [index, peer] of peers.entries()) {
    const evidence = await f.table.evidence(peer.id);
    expect(evidence.wallet.balance.amount).toBe(index === 6 ? '100.20' : '99.00');
    expect(evidence.ledger.items).toHaveLength(index === 6 ? 3 : 2);
    expect(evidence.reconciliation.difference.amount).toBe('0.00');
  }
  const state = f.table.view().state!;
  expect(new Set(state.operations.map((operation) => operation.api)).size).toBe(3);
  await f.table.repeat(state.operations.find((operation) => operation.effect === 'bet')!.id);
  expect(f.table.view().replay!.result.balance.amount).toBe('99.00');
  expect(f.table.view().replay!.result.idempotentReplay).toBe(true);
  await f.table.nextRound();
  await f.table.takeoff();
  f.advance(10000);
  await f.table.tick();
  await f.table.nextRound();
  expect(f.table.view().state!.history!.operationCount).toBe(14);
  expect(f.table.dashboardView().completedOperationCount).toBe(35);
});

test('shared-wallet autoplay processes sequential peer rounds against one reconciled wallet', async () => {
  const f = await fixture(4, 'shared', api, true);
  const peers = f.table.view().state!.peers;
  const walletId = peers[0]!.walletId;
  const playerId = peers[0]!.playerId;

  expect(new Set(peers.map((peer) => peer.walletId)).size).toBe(1);
  expect(new Set(peers.map((peer) => peer.playerId)).size).toBe(1);
  expect(f.table.dashboardView().roundSummary).toMatchObject({ bets: 4, wagered: '4.00' });
  expect(
    f.table
      .view()
      .state!.operations.filter((operation) => operation.effect === 'bet')
      .every(
        (operation) =>
          operation.command.walletId === walletId && operation.command.playerId === playerId,
      ),
  ).toBe(true);

  f.advance(3000);
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary).toMatchObject({ cashed: 4, lost: 0, paid: '6.70' });

  await f.table.nextRound();
  expect(f.table.dashboardView().roundSummary).toMatchObject({ bets: 4, wagered: '4.00' });
  f.advance(3000);
  await f.table.tick();
  f.advance(10000);
  await f.table.tick();
  expect(f.table.dashboardView().roundSummary).toMatchObject({ cashed: 0, lost: 4, paid: '0.00' });

  const evidence = await f.table.evidence(peers[0]!.id);
  expect(evidence.wallet.walletId).toBe(walletId);
  expect(evidence.wallet.balance.amount).toBe('98.70');
  expect(evidence.reconciliation).toMatchObject({
    consistent: true,
    difference: { amount: '0.00' },
  });
  expect(walletIds).toEqual(new Set([walletId]));
});

test('independent peers refund, cash out and lose; replay is historical and rollback uses exact WIN', async () => {
  const f = await fixture(3, 'independent');
  const peers = f.table.view().state!.peers;
  await f.table.place(
    peers.map((p) => p.id),
    '25.00',
  );
  const bets = f.table.view().state!.bets;
  await f.table.settle(bets[0]!.id, 'refund');
  await f.table.takeoff();
  f.advance(1000);
  await f.table.settle(bets[1]!.id, 'win');
  f.advance(10000);
  await f.table.tick();
  expect((await f.table.evidence(peers[0]!.id)).wallet.balance.amount).toBe('100.00');
  expect((await f.table.evidence(peers[1]!.id)).wallet.balance.amount).toBe('104.75');
  expect((await f.table.evidence(peers[2]!.id)).wallet.balance.amount).toBe('75.00');
  await f.table.repeat(bets[1]!.openingId);
  expect(f.table.view().replay!.result).toMatchObject({
    idempotentReplay: true,
    balance: { amount: '75.00' },
  });
  expect(await f.table.conflict(bets[1]!.openingId)).toBe(409);
  expect((await f.table.evidence(peers[1]!.id)).ledger.items).toHaveLength(3);
  await f.table.settle(bets[1]!.id, 'rollback');
  const evidence = await f.table.evidence(peers[1]!.id);
  expect(evidence.wallet.balance.amount).toBe('75.00');
  expect(evidence.ledger.items).toHaveLength(4);
  expect(evidence.reconciliation.difference.amount).toBe('0.00');
});

test('a lost response after real WIN commit replays the saved identity on another API after restart', async () => {
  let lose = true;
  const financial: FinancialApi = {
    urls: api.urls,
    openWallet: () => api.openWallet(),
    inspect: (id, cursor) => api.inspect(id, cursor),
    conflict: (command) => api.conflict(command),
    process: async (command) => {
      const response = await api.process(command);
      if (command.kind === WagerKind.WIN && lose) {
        lose = false;
        throw new Error('response lost after commit');
      }
      return response;
    },
  };
  const f = await fixture(1, 'independent', financial);
  const peer = f.table.view().state!.peers[0]!;
  await f.table.place([peer.id], '25.00');
  await f.table.takeoff();
  f.advance(1000);
  await f.table.settle(f.table.view().state!.bets[0]!.id, 'win');
  expect(f.table.view().blocked).toBe(true);
  const before = await f.table.evidence(peer.id);
  const restarted = new DemoTable(financial, f.journal, f.clock, { crashPoint: f.crashPoint });
  await restarted.recover();
  const state = restarted.view().state!;
  expect(state.operations.map((op) => op.command.kind)).toEqual([WagerKind.BET, WagerKind.WIN]);
  expect(state.operations[1]!.result!.idempotentReplay).toBe(true);
  expect(restarted.view().blocked).toBe(false);
  expect(await restarted.evidence(peer.id)).toEqual(before);
});

test('local demo HTTP routes serve assets and queue the next round against real financial APIs', async () => {
  const { table, advance } = await fixture(1, 'independent');
  const server = startDemoServer(table, 0);
  try {
    expect((await fetch(server.url)).status).toBe(200);
    for (const path of ['client.js', 'style.css', 'vendor/cena.js', 'vendor/sprites/heroi.png']) {
      expect((await fetch(new URL(path, server.url))).status).toBe(200);
    }
    const send = (body: unknown, origin?: string) =>
      fetch(new URL('demo/bet', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      });
    const initializing = startDemoServer(table, 0, { isReady: () => false });
    try {
      expect((await fetch(initializing.url)).status).toBe(200);
      expect((await fetch(new URL('demo/health', initializing.url))).status).toBe(204);
      expect(
        (
          await fetch(new URL('demo/autoplay', initializing.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true }),
          })
        ).status,
      ).toBe(503);
    } finally {
      await initializing.stop(true);
    }
    expect((await send({}, 'https://another.example')).status).toBe(403);
    const configure = (peersPerRound: unknown) =>
      fetch(new URL('demo/autoplay', server.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, peersPerRound }),
      });
    expect((await configure('8000')).status).toBe(400);
    expect((await configure(8001)).status).toBe(400);
    expect((await configure(8000)).status).toBe(200);
    expect(table.view().state!.autoplay!.peersPerRound).toBe(8000);
    expect((await send({ amount: 25, peerIds: [] })).status).toBe(400);
    expect(
      (await send({ amount: '25.00', peerIds: [table.view().state!.peers[0]!.id] })).status,
    ).toBe(200);
    expect(table.view().state!.scheduledBets).toHaveLength(1);
    expect((await table.evidence(table.view().state!.peers[0]!.id)).wallet.balance.amount).toBe(
      '100.00',
    );
    await table.takeoff();
    advance(10000);
    await table.tick();
    await table.nextRound();
    expect((await table.evidence(table.view().state!.peers[0]!.id)).wallet.balance.amount).toBe(
      '75.00',
    );
    const proxy = startDemoServer(table, 0, { publicOrigin: 'https://jungle.subiu.dev' });
    try {
      const cancel = (origin: string) =>
        fetch(new URL('demo/cancel', proxy.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin },
          body: JSON.stringify({ id: table.view().state!.bets[0]!.id }),
        });
      expect((await cancel('https://another.example')).status).toBe(403);
      expect((await cancel('https://jungle.subiu.dev')).status).toBe(200);
      expect((await table.evidence(table.view().state!.peers[0]!.id)).wallet.balance.amount).toBe(
        '100.00',
      );
    } finally {
      await proxy.stop(true);
    }
  } finally {
    await server.stop(true);
  }
});
