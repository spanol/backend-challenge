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
const phaseTimeoutMs = Number(process.env.DEMO_LOAD_PHASE_TIMEOUT_MS ?? 600000);
if (
  !Number.isSafeInteger(peers) ||
  peers < 3 ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 30
)
  throw new Error('Configure pelo menos 3 peers e 1–30 rodadas');
if (!Number.isSafeInteger(phaseTimeoutMs) || phaseTimeoutMs < 1000)
  throw new Error('DEMO_LOAD_PHASE_TIMEOUT_MS inválido');

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
    signal: AbortSignal.timeout(path === '/demo/session' ? phaseTimeoutMs : 30000),
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

async function waitForRound(roundNumber: number, phase: 'betting' | 'flying' | 'crashed') {
  const deadline = Date.now() + phaseTimeoutMs;
  while (true) {
    const view = await state();
    if (view.state?.roundNumber === roundNumber && view.state.phase === phase && !view.blocked)
      return view;
    if (phase === 'crashed' && (view.state?.roundNumber ?? 0) > roundNumber && !view.blocked)
      return view;
    if ((view.state?.roundNumber ?? 0) > roundNumber)
      throw new Error(`Rodada ${roundNumber} avançou antes da fase ${phase}`);
    if (Date.now() >= deadline) throw new Error(`Rodada ${roundNumber} não chegou a ${phase}`);
    await Bun.sleep(200);
  }
}

async function activeBets(roundNumber: number, count: number) {
  const deadline = Date.now() + phaseTimeoutMs;
  while (true) {
    const view = await state();
    if (
      view.state?.roundNumber === roundNumber &&
      view.state.phase === 'betting' &&
      view.state.bets.filter((bet) => bet.roundId === view.state!.roundId).length === count &&
      !view.blocked
    )
      return view;
    if ((view.state?.roundNumber ?? 0) > roundNumber)
      throw new Error(`Apostas da rodada ${roundNumber} não foram ativadas`);
    if (Date.now() >= deadline) throw new Error(`Apostas da rodada ${roundNumber} não ativaram`);
    await Bun.sleep(200);
  }
}

async function verify(name: string): Promise<void> {
  const view = await state();
  if (!view.state || view.blocked) throw new Error('Mesa ausente ou com operação pendente');
  const current = view.state;
  const owners = new Map(current.peers.map((peer) => [peer.id, peer]));
  const representatives = new Map(current.peers.map((peer) => [peer.walletId, peer]));
  const expectedByWallet = new Map([...representatives.keys()].map((id) => [id, 10000n]));

  for (const op of current.operations) {
    const owner = owners.get(op.peerId);
    if (!owner) throw new Error(`Peer ausente na operação ${op.id}`);
    if (op.result?.status !== WagerStatus.PROCESSED) continue;
    const amount = cents(op.command.money.amount);
    const delta =
      op.command.kind === WagerKind.BET || op.command.kind === WagerKind.ROLLBACK
        ? -amount
        : op.command.kind === WagerKind.WIN || op.command.kind === WagerKind.REFUND
          ? amount
          : 0n;
    expectedByWallet.set(owner.walletId, expectedByWallet.get(owner.walletId)! + delta);
  }

  const entries = [...representatives.entries()];
  const wallets = [];

  for (let i = 0; i < entries.length; i += 16) {
    const batch = await Promise.all(
      entries.slice(i, i + 16).map(async ([walletId, peer]) => {
        const expected = decimal(expectedByWallet.get(walletId)!);
        const evidence = await request<Evidence>(
          `/demo/evidence?peerId=${encodeURIComponent(peer.id)}`,
        );

        if (
          !evidence.reconciliation.consistent ||
          evidence.reconciliation.difference.amount !== '0.00' ||
          evidence.wallet.balance.amount !== expected ||
          evidence.reconciliation.calculatedBalance.amount !== expected
        )
          throw new Error(`Saldo ou reconciliação divergente na wallet ${walletId}`);

        return { walletId, expected, actual: evidence.wallet.balance.amount, consistent: true };
      }),
    );

    wallets.push(...batch);
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
  const roundNumber = session.state!.roundNumber + 1;
  await post('bet', {
    peerIds: session.state!.peers.map((peer) => peer.id),
    amount: '5.00',
  });
  const placed = await activeBets(roundNumber, count);
  if (placed.blocked || placed.state!.bets.some((bet) => bet.status !== 'active'))
    throw new Error('BET independente não processada');
  const bets = placed.state!.bets;
  const showcase = Math.min(3, Math.floor(count / 3));
  const cancelled = bets.slice(0, showcase);
  const cashed = bets.slice(showcase, showcase * 2);
  await Promise.all(cancelled.map((bet) => post('cancel', { id: bet.id })));
  await waitForRound(roundNumber, 'flying');
  await Bun.sleep(200);
  await Promise.all(cashed.map((bet) => post('cashout', { id: bet.id })));
  const ended = await waitForRound(roundNumber, 'crashed');
  if (
    ended.state!.bets.some(
      (bet, index) =>
        bet.status !== (index < showcase ? 'refunded' : index < showcase * 2 ? 'cashed' : 'lost'),
    )
  )
    throw new Error('Desfecho da rodada mista inesperado');
  await request('/demo/cashout', { id: bets[showcase * 2]!.id }, 409);
  await Promise.all(cashed.map((bet) => post('rollback', { id: bet.id })));
  for (const bet of bets.slice(0, 10)) {
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
  const roundNumber = session.state!.roundNumber + 1;
  await post('bet', {
    peerIds: session.state!.peers.map((peer) => peer.id),
    amount: '80.00',
  });
  const placed = await activeBets(roundNumber, peers);
  const bets = placed.state!.bets;
  if (
    placed.blocked ||
    bets.filter((bet) => bet.status === 'active').length !== 1 ||
    bets.filter((bet) => bet.status === 'rejected').length !== peers - 1
  )
    throw new Error('Disputa de saldo não teve exatamente uma BET aceita');
  await post('cancel', { id: bets.find((bet) => bet.status === 'active')!.id });
  for (const bet of bets.slice(0, 10)) {
    const replay = await post('replay', { id: bet.openingId });
    if (!replay.replay?.result.idempotentReplay)
      throw new Error('Replay da disputa não confirmado');
  }
  await verify(name);
}

try {
  let before = await state();
  const readyDeadline = Date.now() + 30000;
  while (before.state?.phase === 'flying' && !before.blocked) {
    if (Date.now() >= readyDeadline)
      throw new Error('Mesa não encerrou o voo para iniciar a bateria');
    await Bun.sleep(200);
    before = await state();
  }
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
