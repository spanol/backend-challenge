import { cpus, platform, totalmem } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { newId } from '../src/application/contracts';
import type { WalletView } from '../src/application/types/wallet';
import { WagerKind, WagerStatus } from '../src/domain/constants/wager';
import { isOutboxDrained, loadSample, samplePeak } from './load-metrics';
import type { LoadSample, LoadReconciliation } from './types/load';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const requests = Number(process.env.LOAD_REQUESTS ?? 300);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 12);
const walletCount = Number(process.env.LOAD_WALLETS ?? 12);
const drainTimeoutSeconds = Number(process.env.LOAD_DRAIN_TIMEOUT_SECONDS ?? 180);

for (const value of [requests, concurrency, walletCount])
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000)
    throw new Error('Invalid load configuration');

if (
  !Number.isSafeInteger(drainTimeoutSeconds) ||
  drainTimeoutSeconds < 1 ||
  drainTimeoutSeconds > 600
)
  throw new Error('Invalid load drain timeout');

const wallets: (Pick<WalletView, 'walletId' | 'playerId'> & { expectedDebits: number })[] = [];

async function metrics() {
  const response = await fetch(`${baseUrl}/metrics`, { signal: AbortSignal.timeout(10000) });

  if (!response.ok) throw new Error(`Metrics unavailable: ${response.status}`);

  return response.text();
}

for (let i = 0; i < walletCount; i++) {
  const playerId = newId();

  const response = await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: '10000.00', currency: 'BRL' } }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`Wallet setup failed: ${response.status}`);

  const wallet = (await response.json()) as { id: string };

  wallets.push({ walletId: wallet.id, playerId, expectedDebits: 0 });
}

async function bet(index: number): Promise<boolean> {
  const wallet = wallets[index % walletCount]!;

  const response = await fetch(`${baseUrl}/wagering/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newId() },
    body: JSON.stringify({
      walletId: wallet.walletId,
      playerId: wallet.playerId,
      providerId: 'load-test',
      externalTransactionId: newId(),
      roundId: 'load-round',
      gameId: 'load-game',
      kind: WagerKind.BET,
      money: { amount: '0.01', currency: 'BRL' },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const result = (await response.json()) as { status?: WagerStatus; idempotentReplay?: boolean };
  const processed =
    response.status === 200 && result.status === WagerStatus.PROCESSED && !result.idempotentReplay;

  if (processed) wallet.expectedDebits++;

  return processed;
}

// Warmup is excluded from measured latency/throughput, but remains in each wallet's final reconciliation.
for (let i = 0; i < 24; i++) if (!(await bet(i))) throw new Error('Warmup failed');

const samples: LoadSample[] = [loadSample(await metrics(), 'baseline')];
let sampling = true;
let phase = 'http-load';
const monitor = (async () => {
  while (sampling) {
    try {
      samples.push(loadSample(await metrics(), phase, samples.at(-1)));
    } catch (error) {
      samples.push({ ...loadSample('', phase), error: String(error) });
    }

    if (sampling) await Bun.sleep(1000);
  }
})();
try {
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
  const reconciliations = [];

  for (const wallet of wallets) {
    const response = await fetch(`${baseUrl}/wallets/${wallet.walletId}/reconciliation`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });

    const result = (await response.json()) as LoadReconciliation;
    const expectedCents = 1000000n - BigInt(wallet.expectedDebits);
    const expectedBalance = `${expectedCents / 100n}.${String(expectedCents % 100n).padStart(2, '0')}`;
    const matchesExpected =
      response.ok &&
      result.consistent &&
      result.storedBalance.amount === expectedBalance &&
      result.calculatedBalance.amount === expectedBalance &&
      result.difference.amount === '0.00' &&
      result.checkedEntries === wallet.expectedDebits + 1;

    consistent &&= matchesExpected;
    reconciliations.push({
      ...result,
      walletId: wallet.walletId,
      expectedBalance,
      matchesExpected,
    });
  }

  phase = 'outbox-recovery';
  const recoveryStarted = performance.now();
  const recoveryStartedAt = Date.now() / 1000;
  let drained = false;

  while (performance.now() - recoveryStarted < drainTimeoutSeconds * 1000) {
    const sample = loadSample(await metrics(), phase, samples.at(-1));

    samples.push(sample);

    if (isOutboxDrained(sample, recoveryStartedAt)) {
      drained = true;

      break;
    }

    await Bun.sleep(1000);
  }

  const recoverySeconds = (performance.now() - recoveryStarted) / 1000;

  sampling = false;
  await monitor;

  const before = samples[0]!;
  const after = samples.at(-1)!;

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
      sampleIntervalMs: 1000,
      drainTimeoutSeconds,
      metricsScope: 'one process at LOAD_BASE_URL; outbox backlog is shared by all publishers',
    },
    elapsedSeconds,
    throughput: requests / elapsedSeconds,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    errors,
    errorRate: errors / requests,
    lockConflicts:
      after.lockConflicts !== null && before.lockConflicts !== null
        ? after.lockConflicts - before.lockConflicts
        : null,
    outboxLagSeconds: after.outboxLagSeconds,
    telemetry: {
      samples: samples.length,
      collectionErrors: samples.filter((sample) => sample.error).length,
      cpuPeakPercentOneCore: samplePeak(samples, 'cpuPercent'),
      rssBaselineBytes: before.rssBytes,
      rssPeakBytes: samplePeak(samples, 'rssBytes'),
      rssFinalBytes: after.rssBytes,
      heapPeakBytes: samplePeak(samples, 'heapBytes'),
      eventLoopP99PeakSeconds: samplePeak(samples, 'eventLoopP99Seconds'),
      outboxPendingPeak: samplePeak(samples, 'outboxPending'),
      outboxLagPeakSeconds: samplePeak(samples, 'outboxLagSeconds'),
    },
    outboxRecovery: { drained, elapsedSeconds: recoverySeconds, pending: after.outboxPending },
    reconciliations,
    allWalletsReconciled: consistent,
  };

  await mkdir('test-results', { recursive: true });
  await Bun.write('test-results/load.json', JSON.stringify(result, null, 2));
  await Bun.write('test-results/load-samples.json', JSON.stringify(samples, null, 2));
  console.log(JSON.stringify(result, null, 2));

  if (errors || !consistent || !drained || result.telemetry.collectionErrors) process.exitCode = 1;
} finally {
  sampling = false;
  await monitor;
}
