import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DemoView, Evidence } from '../demo/types/contracts';
import { WagerKind, WagerStatus } from '../src/domain/constants/wager';
import { Money } from '../src/domain/money';

const base = new URL(process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3200');
if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
  throw new Error('DEMO_BASE_URL deve conter somente a origem da demo');

const peers = Number(process.env.DEMO_LOAD_PEERS ?? 24);
const rounds = Number(process.env.DEMO_LOAD_ROUNDS ?? 6);
if (
  !Number.isInteger(peers) ||
  peers < 3 ||
  peers > 24 ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 30
)
  throw new Error('Configure 3–24 peers e 1–30 rodadas');

const output = resolve(process.env.DEMO_LOAD_OUTPUT ?? `test-results/demo-load-${Date.now()}`);
await mkdir(output, { recursive: true });
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': 'JungleChallenge/1.0 demo-load',
};
if (process.env.DEMO_BASIC_ACCESS_FILE) {
  const access = JSON.parse(await readFile(process.env.DEMO_BASIC_ACCESS_FILE, 'utf8')) as {
    api: { username: string; password: string };
  };
  headers.Authorization = `Basic ${Buffer.from(`${access.api.username}:${access.api.password}`).toString('base64')}`;
}

const report = {
  startedAt: new Date().toISOString(),
  completedAt: '',
  baseUrl: base.origin,
  peers,
  rounds,
  authenticated: Boolean(headers.Authorization),
  requests: [] as { at: string; path: string; status: number; elapsedMs: number }[],
  phases: [] as {
    name: string;
    sessionId: string;
    operations: Record<string, number>;
    wallets: { walletId: string; expected: string; actual: string; consistent: boolean }[];
  }[],
  passed: false,
  error: undefined as string | undefined,
};

async function request<T>(path: string, body?: unknown, expected = 200): Promise<T> {
  if (process.env.DEMO_LOAD_STOP_FILE && (await Bun.file(process.env.DEMO_LOAD_STOP_FILE).exists()))
    throw new Error('Bateria interrompida pelo monitor do host');
  const start = performance.now();
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  report.requests.push({
    at: new Date().toISOString(),
    path,
    status: response.status,
    elapsedMs: performance.now() - start,
  });
  if (response.status !== expected)
    throw new Error(`${path}: HTTP ${response.status}, esperado ${expected}`);
  return response.json() as Promise<T>;
}

const state = () => request<DemoView>('/demo/state');
const post = (path: string, body: unknown = {}) => request<DemoView>(`/demo/${path}`, body);
const cents = (amount: string) =>
  BigInt(Money.from({ amount, currency: 'BRL' }).toString().replace('.', ''));
const decimal = (amount: bigint) =>
  `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;

async function closedRound(): Promise<void> {
  const deadline = Date.now() + 20000;
  while ((await state()).state?.phase !== 'crashed') {
    if (Date.now() >= deadline) throw new Error('Rodada não encerrou dentro do prazo');
    await Bun.sleep(200);
  }
}

async function verify(name: string): Promise<void> {
  const view = await state();
  if (!view.state || view.blocked) throw new Error('Mesa ausente ou com operação pendente');
  const current = view.state;
  const ids = new Set<string>();
  const wallets = [];
  for (const peer of current.peers) {
    if (ids.has(peer.walletId)) continue;
    ids.add(peer.walletId);
    let expected = 10000n;
    for (const op of current.operations) {
      const owner = current.peers.find((candidate) => candidate.id === op.peerId)!;
      if (owner.walletId !== peer.walletId || op.result?.status !== WagerStatus.PROCESSED) continue;
      const amount = cents(op.command.money.amount);
      if ([WagerKind.BET, WagerKind.ROLLBACK].some((kind) => kind === op.command.kind))
        expected -= amount;
      if ([WagerKind.WIN, WagerKind.REFUND].some((kind) => kind === op.command.kind))
        expected += amount;
    }
    const evidence = await request<Evidence>(
      `/demo/evidence?peerId=${encodeURIComponent(peer.id)}`,
    );
    if (
      !evidence.reconciliation.consistent ||
      evidence.reconciliation.difference.amount !== '0.00' ||
      evidence.wallet.balance.amount !== decimal(expected) ||
      evidence.reconciliation.calculatedBalance.amount !== decimal(expected)
    )
      throw new Error(`Saldo ou reconciliação divergente na wallet ${peer.walletId}`);
    wallets.push({
      walletId: peer.walletId,
      expected: decimal(expected),
      actual: evidence.wallet.balance.amount,
      consistent: true,
    });
  }
  const operations: Record<string, number> = {};
  for (const op of current.operations) {
    if (!op.result) throw new Error('Operação sem resultado durável');
    const key = `${op.command.kind}:${op.result.status}`;
    operations[key] = (operations[key] ?? 0) + 1;
  }
  report.phases.push({ name, sessionId: current.sessionId, operations, wallets });
  console.log(JSON.stringify({ phase: name, operations, reconciledWallets: wallets.length }));
}

async function mixed(count: number, name: string): Promise<void> {
  const session = await post('session', { count, mode: 'independent' });
  const placed = await post('bet', {
    peerIds: session.state!.peers.map((peer) => peer.id),
    amount: '5.00',
  });
  if (placed.blocked || placed.state!.bets.some((bet) => bet.status !== 'active'))
    throw new Error('BET independente não processada');
  const bets = placed.state!.bets;
  await Promise.all(
    bets.filter((_, index) => index % 3 === 0).map((bet) => post('cancel', { id: bet.id })),
  );
  await post('takeoff');
  await Bun.sleep(500);
  await Promise.all(
    bets.filter((_, index) => index % 3 === 1).map((bet) => post('cashout', { id: bet.id })),
  );
  await closedRound();
  const ended = await state();
  if (
    ended.state!.bets.some((bet, index) => bet.status !== ['refunded', 'cashed', 'lost'][index % 3])
  )
    throw new Error('Desfecho da rodada mista inesperado');
  await request('/demo/cashout', { id: bets.find((_, index) => index % 3 === 2)!.id }, 409);
  await Promise.all(
    bets.filter((_, index) => index % 3 === 1).map((bet) => post('rollback', { id: bet.id })),
  );
  for (const bet of bets) {
    const replay = await post('replay', { id: bet.openingId });
    if (!replay.replay?.result.idempotentReplay || replay.replay.result.balance.amount !== '95.00')
      throw new Error('Replay não preservou o resultado histórico da BET');
  }
  const conflict = await request<{ status: number }>('/demo/conflict', { id: bets[0]!.openingId });
  if (conflict.status !== 409) throw new Error('Payload divergente não gerou conflito');
  await verify(name);
}

async function shared(name: string): Promise<void> {
  const session = await post('session', { count: peers, mode: 'shared' });
  const placed = await post('bet', {
    peerIds: session.state!.peers.map((peer) => peer.id),
    amount: '80.00',
  });
  const bets = placed.state!.bets;
  if (
    placed.blocked ||
    bets.filter((bet) => bet.status === 'active').length !== 1 ||
    bets.filter((bet) => bet.status === 'rejected').length !== peers - 1
  )
    throw new Error('Disputa de saldo não teve exatamente uma BET aceita');
  await post('cancel', { id: bets.find((bet) => bet.status === 'active')!.id });
  for (const bet of bets) {
    const replay = await post('replay', { id: bet.openingId });
    if (!replay.replay?.result.idempotentReplay)
      throw new Error('Replay da disputa não confirmado');
  }
  await verify(name);
}

try {
  const before = await state();
  if (
    before.blocked ||
    before.state?.phase === 'flying' ||
    before.state?.bets.some((bet) => ['active', 'placing'].includes(bet.status))
  )
    throw new Error('Finalize a rodada atual antes de executar a bateria');
  await mixed(3, 'smoke-3');
  for (let round = 1; round <= rounds; round++) await mixed(peers, `mixed-${peers}-${round}`);
  for (let round = 1; round <= Math.max(1, Math.ceil(rounds / 2)); round++)
    await shared(`shared-${peers}-${round}`);
  await post('session', { count: 3, mode: 'independent' });
  await verify('ready-for-presentation');
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Falha da bateria';
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await Bun.write(resolve(output, 'demo-load.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      passed: report.passed,
      phases: report.phases.length,
      requests: report.requests.length,
      report: resolve(output, 'demo-load.json'),
      error: report.error,
    }),
  );
}
