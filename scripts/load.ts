import { cpus, platform, totalmem } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { newId } from '../src/application/contracts';
import type { WalletView } from '../src/application/types/wallet';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const requests = Number(process.env.LOAD_REQUESTS ?? 300);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 12);
const walletCount = Number(process.env.LOAD_WALLETS ?? 12);

for (const value of [requests, concurrency, walletCount])
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000)
    throw new Error('Invalid load configuration');

const wallets: Pick<WalletView, 'walletId' | 'playerId'>[] = [];

async function metrics() {
  return (await fetch(`${baseUrl}/metrics`)).text();
}

function metric(text: string, name: string): number {
  const match = text.match(new RegExp(`^${name} ([0-9.e+-]+)$`, 'm'));

  return Number(match?.[1] ?? 0);
}

for (let i = 0; i < walletCount; i++) {
  const playerId = newId();

  const response = await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: '10000.00', currency: 'BRL' } }),
  });

  if (!response.ok) throw new Error(`Wallet setup failed: ${response.status}`);

  const wallet = (await response.json()) as { walletId: string };

  wallets.push({ walletId: wallet.walletId, playerId });
}

async function bet(index: number): Promise<boolean> {
  const wallet = wallets[index % walletCount]!;

  const response = await fetch(`${baseUrl}/wagering/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newId() },
    body: JSON.stringify({
      ...wallet,
      providerId: 'load-test',
      externalTransactionId: newId(),
      roundId: 'load-round',
      gameId: 'load-game',
      kind: 'BET',
      money: { amount: '0.01', currency: 'BRL' },
    }),
  });

  await response.arrayBuffer();

  return response.status === 200;
}

// Warmup is excluded from measured latency/throughput, but remains in each wallet's final reconciliation.
for (let i = 0; i < 24; i++) if (!(await bet(i))) throw new Error('Warmup failed');

const before = await metrics();
const durations: number[] = [];
let errors = 0;
let next = 0;
const start = performance.now();

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < requests) {
      const index = next++;
      const at = performance.now();

      try {
        if (!(await bet(index))) errors++;
      } catch {
        errors++;
      }

      durations.push(performance.now() - at);
    }
  }),
);

const elapsedSeconds = (performance.now() - start) / 1000;

durations.sort((a, b) => a - b);

const percentile = (p: number) =>
  durations[Math.min(durations.length - 1, Math.ceil(p * durations.length) - 1)]!;

let consistent = true;

for (const wallet of wallets) {
  const response = await fetch(`${baseUrl}/wallets/${wallet.walletId}/reconciliation`, {
    method: 'POST',
  });

  const result = (await response.json()) as { consistent: boolean };

  consistent &&= response.ok && result.consistent;
}

const after = await metrics();

const result = {
  measuredAt: new Date().toISOString(),
  environment: {
    platform: platform(),
    bun: Bun.version,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    baseUrl,
  },
  methodology: {
    transport: 'HTTP',
    warmup: 24,
    requests,
    concurrency,
    wallets: walletCount,
    operation: 'BET 0.01 BRL',
    includesOutbox: true,
  },
  elapsedSeconds,
  throughput: requests / elapsedSeconds,
  latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
  errors,
  errorRate: errors / requests,
  lockConflicts:
    metric(after, 'wager_lock_conflicts_total') - metric(before, 'wager_lock_conflicts_total'),
  outboxLagSeconds: metric(after, 'wager_outbox_lag_seconds'),
  allWalletsReconciled: consistent,
};

await mkdir('test-results', { recursive: true });
await Bun.write('test-results/load.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

if (errors || !consistent) process.exitCode = 1;
