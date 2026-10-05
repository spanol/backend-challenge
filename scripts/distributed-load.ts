import { GetQueueAttributesCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { cpus, platform } from 'node:os';
import { createHash } from 'node:crypto';
import { newId } from '../src/application/contracts';
import type { ProcessingResult } from '../src/application/types/wagering';
import { WagerKind, WagerStatus } from '../src/domain/constants/wager';
import { WagerMessageType } from '../src/domain/constants/messages';
import { FinancialErrorCode } from '../src/domain/constants/errors';
import type { WagerCommand } from '../src/domain/types/wager';
import { connectDatabase } from '../src/infrastructure/persistence/database';
import { sqsClient, resolveQueues } from '../src/infrastructure/messaging/sqs';
import { requireTestIsolation } from '../tests/helpers/isolated-environment';
import { loadSample, metric } from './load-metrics';
import { runGameLoad } from './distributed-game-load';
import type { LoadReconciliation } from './types/load';
import type {
  HistoricalResult,
  HttpAttempt,
  LoadPhase,
  LoadWallet,
  ReplicaSample,
} from './types/distributed-load';

const resourceId = requireTestIsolation();
const urls = (
  process.env.DISTRIBUTED_LOAD_URLS ??
  'http://replica-1:3000,http://replica-2:3000,http://replica-3:3000'
).split(',');
if (urls.length !== 3 || new Set(urls).size !== 3)
  throw new Error('Exactly three distinct replica URLs are required');
const profile = process.env.DISTRIBUTED_LOAD_PROFILE ?? 'heavy';
if (!['smoke', 'heavy', 'game-smoke', 'game-scale'].includes(profile))
  throw new Error('Unknown distributed load profile');
const game = profile.startsWith('game-');
const smoke = profile === 'smoke';
const plans = [
  {
    name: 'balanced-http',
    count: smoke ? 600 : 10000,
    clients: smoke ? 32 : 256,
    wallets: 128,
    amount: '0.01',
  },
  { name: 'hot-wallet', count: smoke ? 300 : 3000, clients: 48, wallets: 1, amount: '1.00' },
  {
    name: 'http-sqs-duplicates',
    count: smoke ? 100 : 1000,
    clients: 64,
    wallets: 64,
    amount: '0.01',
  },
  { name: 'replica-loss', count: smoke ? 1000 : 5000, clients: 128, wallets: 64, amount: '0.01' },
];
const db = await connectDatabase(true);
const client = sqsClient();
const queues = await resolveQueues(client);
const attempts: HttpAttempt[] = [];
const samples: ReplicaSample[] = [];
const phases: LoadPhase[] = [];
let phaseName = 'startup';
let monitoring = true;
let crashRequested = false;
let allWallets = 0;
const report = {
  resourceId,
  profile,
  startedAt: new Date().toISOString(),
  completedAt: '',
  environment: { bun: Bun.version, platform: platform(), cpu: cpus()[0]?.model, urls },
  methodology: {
    replicas: 3,
    sharedDatabase: true,
    sharedQueues: true,
    workersPerReplica: ['sqs', 'outbox', 'references'],
    warmup: game ? 0 : 24,
    sampleIntervalMs: 2000,
    requestTimeoutMs: game ? 8000 : 30000,
    httpConnectionReuse: game && process.env.GAME_LOAD_CONNECTION_REUSE !== 'false',
    retriesDuringReplicaLoss: game ? 0 : 3,
    crash: 'SIGKILL replica-1 during active load, restart after five seconds',
    metrics: 'per replica and process generation; shared outbox gauges must not be summed',
    downstream:
      'outbox SQL acknowledgement and published SQS events; no downstream business consumer',
  },
  phases,
  sqlSessions: [] as unknown[],
  finalAudit: {} as Record<string, string>,
  game: undefined as Awaited<ReturnType<typeof runGameLoad>> | undefined,
  passed: false,
  error: undefined as string | undefined,
};

async function control(action: string) {
  await Bun.write(
    'test-results/distributed-control.json',
    JSON.stringify({ resourceId, action, at: new Date().toISOString() }),
  );
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function ready() {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const r = await fetch(`${url}/health/ready`, {
          keepalive: false,
          signal: AbortSignal.timeout(5000),
        });
        return r.ok;
      }),
    );
    if (results.every((r) => r.status === 'fulfilled' && r.value)) return;
    await Bun.sleep(1000);
  }
  throw new Error('Three replicas did not become ready');
}

async function capture() {
  await Promise.all(
    urls.map(async (url, replica) => {
      const previous = samples.filter((s) => s.replica === replica && !s.error).at(-1);
      try {
        const r = await fetch(`${url}/metrics`, {
          keepalive: false,
          signal: AbortSignal.timeout(10000),
        });
        check(r.ok, `Metrics HTTP ${r.status}`);
        const text = await r.text();
        samples.push({
          ...loadSample(text, phaseName, previous),
          replica,
          generation: metric(text, 'process_start_time_seconds'),
          sqsCount: metric(text, 'wager_processing_seconds_count{transport="sqs"}'),
          publisherAccepted: metric(text, 'load_outbox_accepted_total'),
        });
      } catch (error) {
        samples.push({
          ...loadSample('', phaseName),
          replica,
          generation: null,
          sqsCount: null,
          publisherAccepted: null,
          error: String(error),
        });
      }
    }),
  );
}

async function walletSet(count: number, hot: boolean): Promise<LoadWallet[]> {
  const wallets: LoadWallet[] = [];
  for (let i = 0; i < count; i += 8) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(8, count - i) }, async (_, offset) => {
        const playerId = newId();
        const r = await fetch(`${urls[(i + offset) % 3]}/wallets`, {
          keepalive: false,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId,
            initialBalance: { amount: hot ? '100.00' : '10000.00', currency: 'BRL' },
          }),
          signal: AbortSignal.timeout(30000),
        });
        check(r.status === 201, `Wallet HTTP ${r.status}`);
        const body = (await r.json()) as { id: string };
        return {
          walletId: body.id,
          playerId,
          initialCents: hot ? 10000n : 1000000n,
          expectedDebits: 0,
        };
      }),
    );
    wallets.push(...batch);
  }
  allWallets += wallets.length;
  return wallets;
}

function command(wallet: LoadWallet, amount: string): WagerCommand {
  return {
    walletId: wallet.walletId,
    playerId: wallet.playerId,
    providerId: 'distributed-load',
    externalTransactionId: newId(),
    idempotencyKey: newId(),
    roundId: phaseName,
    gameId: 'distributed-load',
    kind: WagerKind.BET,
    money: { amount, currency: 'BRL' },
  };
}

async function send(
  c: WagerCommand,
  replica: number,
  p: LoadPhase,
  retry = false,
): Promise<ProcessingResult> {
  const { idempotencyKey, ...body } = c;
  for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
    const target = (replica + attempt) % 3;
    const start = performance.now();
    const record: HttpAttempt = {
      phase: p.name,
      replica: target,
      key: idempotencyKey,
      at: new Date().toISOString(),
      elapsedMs: 0,
    };
    p.replicas[target]!.requests++;
    try {
      const r = await fetch(`${urls[target]}/wagering/transactions`, {
        keepalive: false,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Correlation-Id': idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      record.status = r.status;
      p.replicas[target]!.responses++;
      if (r.status !== 200 && r.status !== 422) {
        p.unexpectedHttp++;
        if (retry && r.status >= 500 && attempt < 2) continue;
        throw new Error(`Unexpected wagering HTTP ${r.status}`);
      }
      const result = (await r.json()) as ProcessingResult;
      check(
        result.status === WagerStatus.PROCESSED || result.status === WagerStatus.REJECTED,
        'Non-terminal result',
      );
      check(
        (r.status === 200) === (result.status === WagerStatus.PROCESSED),
        'HTTP/result mismatch',
      );
      if (result.status === WagerStatus.REJECTED)
        check(
          p.name === 'hot-wallet' && result.failureCode === FinancialErrorCode.INSUFFICIENT_FUNDS,
          'Unexpected rejection',
        );
      return result;
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      if (record.status === undefined) {
        p.transportErrors++;
        p.replicas[target]!.transportErrors++;
      }
      if (!retry || record.status !== undefined || attempt === 2) throw error;
    } finally {
      record.elapsedMs = performance.now() - start;
      attempts.push(record);
    }
  }
  throw new Error('No terminal response');
}

async function parallel<T>(
  count: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const settled = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const i = next++;
        results[i] = await task(i);
      }
    }),
  );
  for (const result of settled) if (result.status === 'rejected') throw result.reason;
  return results;
}

async function drain(inbox: number): Promise<number> {
  const start = performance.now();
  const deadline = Date.now() + 600000;
  let stable = 0;
  while (Date.now() < deadline) {
    const [counts] = await db.em
      .fork()
      .execute<{ pending: string; inbox: string }[]>(
        'SELECT (SELECT count(*) FROM outbox WHERE published_at IS NULL)::text pending, (SELECT count(*) FROM inbox)::text inbox',
      );
    const attrs = await Promise.all(
      [queues.requests, queues.dlq].map((QueueUrl) =>
        client.send(
          new GetQueueAttributesCommand({
            QueueUrl,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
              'ApproximateNumberOfMessagesDelayed',
            ],
          }),
        ),
      ),
    );
    check(
      Object.values(attrs[1]!.Attributes ?? {}).every((value) => Number(value) === 0),
      'DLQ is not empty',
    );
    const idle =
      !game ||
      (
        await Promise.all(
          urls.map(async (url) => {
            try {
              const response = await fetch(`${url}/metrics`, {
                keepalive: false,
                signal: AbortSignal.timeout(10000),
              });
              return response.ok && metric(await response.text(), 'load_wager_inflight') === 0;
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    const clean =
      idle &&
      counts!.pending === '0' &&
      Number(counts!.inbox) === inbox &&
      Object.values(attrs[0]!.Attributes ?? {}).every((value) => Number(value) === 0);
    stable = clean ? stable + 1 : 0;
    if (stable >= 2) return (performance.now() - start) / 1000;
    await Bun.sleep(1000);
  }
  throw new Error('Inbox/input queue/outbox did not drain within 600 seconds');
}

async function reconcile(wallets: LoadWallet[], cents: bigint): Promise<unknown[]> {
  return parallel(wallets.length, 8, async (i) => {
    const w = wallets[i]!;
    const amount = w.initialCents - BigInt(w.expectedDebits) * cents;
    const expected = `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
    const r = await fetch(`${urls[i % 3]}/wallets/${w.walletId}/reconciliation`, {
      keepalive: false,
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });
    const recon = (await r.json()) as LoadReconciliation;
    const wr = await fetch(`${urls[(i + 1) % 3]}/wallets/${w.walletId}`, {
      keepalive: false,
      signal: AbortSignal.timeout(30000),
    });
    const wallet = (await wr.json()) as { version: number };
    check(
      r.ok &&
        wr.ok &&
        recon.consistent &&
        recon.difference.amount === '0.00' &&
        recon.storedBalance.amount === expected &&
        recon.calculatedBalance.amount === expected &&
        recon.checkedEntries === w.expectedDebits + 1 &&
        wallet.version === w.expectedDebits + 1,
      `Reconciliation/expected version mismatch ${w.walletId}`,
    );
    return {
      ...recon,
      expectedBalance: expected,
      expectedVersion: w.expectedDebits + 1,
      observedVersion: wallet.version,
      matchesExpected: true,
    };
  });
}

async function audit(
  wallets: LoadWallet[],
  commands: WagerCommand[],
  processed: number,
  rejected: number,
) {
  const count = commands.length;
  const ids = `{${wallets.map((w) => w.walletId).join(',')}}`;
  const [row] = await db.em.fork().execute<Record<string, string>[]>(
    `SELECT
    (SELECT count(*) FROM wager_transactions WHERE wallet_id=ANY(?::uuid[]) AND kind<>'OPENING')::text transactions,
    (SELECT count(*) FROM wager_transactions WHERE wallet_id=ANY(?::uuid[]) AND kind='BET' AND status='PROCESSED')::text processed,
    (SELECT count(*) FROM wager_transactions WHERE wallet_id=ANY(?::uuid[]) AND kind='BET' AND status='REJECTED')::text rejected,
    (SELECT count(*) FROM wallet_ledger WHERE wallet_id=ANY(?::uuid[]))::text ledger,
    (SELECT count(*) FROM accounting_journals WHERE wallet_id=ANY(?::uuid[]))::text journals,
    (SELECT count(*) FROM outbox WHERE aggregate_id=ANY(?::uuid[]))::text events`,
    Array.from({ length: 6 }, () => ids),
  );
  check(
    Number(row!.transactions) === count &&
      Number(row!.processed) === processed &&
      Number(row!.rejected) === rejected &&
      Number(row!.ledger) === processed + wallets.length &&
      row!.ledger === row!.journals &&
      Number(row!.events) === 2 * (processed + wallets.length) + rejected,
    'SQL cardinalities differ from independent workload plan',
  );
  const identities = await db.em
    .fork()
    .execute<{ key: string; wallet: string; amount: string }[]>(
      "SELECT idempotency_key key,wallet_id::text wallet,amount::text amount FROM wager_transactions WHERE wallet_id=ANY(?::uuid[]) AND kind='BET'",
      [ids],
    );
  const planned = new Map(commands.map((c) => [c.idempotencyKey, c]));
  check(
    identities.length === commands.length &&
      identities.every(
        (r) =>
          planned.get(r.key)?.walletId === r.wallet &&
          planned.get(r.key)?.money.amount === r.amount,
      ),
    'SQL identities/payloads differ from saved workload plan',
  );
  return { ...row!, matchedIdentities: String(identities.length) };
}

async function runPhase(plan: (typeof plans)[number], warmup = false) {
  phaseName = warmup ? 'warmup' : plan.name;
  const p: LoadPhase = {
    name: phaseName,
    startedAt: new Date().toISOString(),
    uniqueCommands: plan.count,
    concurrency: plan.clients,
    wallets: plan.wallets,
    amount: plan.amount,
    sqsDeliveries: 0,
    processed: 0,
    rejected: 0,
    logicalFailures: 0,
    transportErrors: 0,
    unexpectedHttp: 0,
    expectedOutages: 0,
    replayChecks: 0,
    replicas: urls.map(() => ({ requests: 0, responses: 0, transportErrors: 0 })),
    passed: false,
  };
  phases.push(p);
  await control(phaseName);
  try {
    const wallets = await walletSet(plan.wallets, p.name === 'hot-wallet');
    const commands = Array.from({ length: plan.count }, (_, i) =>
      command(wallets[i % wallets.length]!, plan.amount),
    );
    const savedPlan = JSON.stringify(commands);
    p.planHash = createHash('sha256').update(savedPlan).digest('hex');
    await Bun.write(`test-results/plan-${p.name}.json`, savedPlan);
    await capture();
    const history: HistoricalResult[] = [];
    const durations: number[] = [];
    const start = performance.now();
    const mixed = p.name === 'http-sqs-duplicates';
    const sqs = mixed
      ? (async () => {
          await parallel(Math.ceil(commands.length / 5), 4, async (batch) => {
            const entries = commands.slice(batch * 5, batch * 5 + 5).flatMap((c, i) =>
              [0, 1].map((duplicate) => ({
                Id: `${i}-${duplicate}`,
                MessageBody: JSON.stringify({
                  type: WagerMessageType.TRANSACTION_REQUESTED,
                  messageId: c.idempotencyKey,
                  occurredAt: new Date().toISOString(),
                  data: c,
                }),
                MessageGroupId: c.walletId,
                MessageDeduplicationId: newId(),
              })),
            );
            const result = await client.send(
              new SendMessageBatchCommand({ QueueUrl: queues.requests, Entries: entries }),
            );
            check(
              !result.Failed?.length && result.Successful?.length === entries.length,
              'SQS batch failure',
            );
            p.sqsDeliveries += entries.length;
          });
        })()
      : Promise.resolve();
    let completed = 0;
    const work = await Promise.allSettled([
      sqs,
      parallel(commands.length, plan.clients, async (i) => {
        const c = commands[i]!;
        const at = performance.now();
        try {
          const result = await send(c, i % 3, p, p.name === 'replica-loss');
          if (mixed) {
            const replay = await send(c, (i + 1) % 3, p);
            check(
              replay.idempotentReplay &&
                replay.transactionId === result.transactionId &&
                replay.balance.amount === result.balance.amount &&
                replay.status === result.status,
              'Cross-replica replay differs',
            );
          }
          if (result.status === WagerStatus.PROCESSED) {
            p.processed++;
            wallets[i % wallets.length]!.expectedDebits++;
          } else p.rejected++;
          if (i < 96) history.push({ command: c, result, replica: i % 3 });
        } catch (error) {
          p.logicalFailures++;
          throw error;
        } finally {
          durations.push(performance.now() - at);
        }
        completed++;
        if (p.name === 'replica-loss' && completed >= 100 && !crashRequested) {
          crashRequested = true;
          await control('kill-replica-1');
        }
      }),
    ]);
    for (const result of work)
      if (result.status === 'rejected')
        throw new Error('Workload failed', { cause: result.reason });
    p.elapsedSeconds = (performance.now() - start) / 1000;
    p.throughput = plan.count / p.elapsedSeconds;
    durations.sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      durations[Math.min(durations.length - 1, Math.ceil(durations.length * fraction) - 1)]!;
    p.latencyMs = { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
    phaseName = `${p.name}-recovery`;
    p.recoverySeconds = await drain(mixed || p.name === 'replica-loss' ? (smoke ? 100 : 1000) : 0);
    await capture();
    if (mixed) {
      p.workers = urls.map((_, replica) => {
        const records = samples.filter(
          (s) => s.replica === replica && s.phase.startsWith(p.name) && !s.error,
        );
        return {
          replica,
          sqsRequests: (records.at(-1)?.sqsCount ?? 0) - (records[0]?.sqsCount ?? 0),
          publisherAccepted:
            (records.at(-1)?.publisherAccepted ?? 0) - (records[0]?.publisherAccepted ?? 0),
        };
      });
      check(
        p.workers.every((w) => w.sqsRequests > 0 && w.publisherAccepted > 0),
        'Every replica must consume and publish during the mixed phase',
      );
    }
    p.expectedOutages = samples.filter(
      (s) => s.error && s.phase.startsWith(p.name) && p.name === 'replica-loss',
    ).length;
    const expectedProcessed = p.name === 'hot-wallet' ? 100 : plan.count;
    check(
      p.processed === expectedProcessed &&
        p.rejected === plan.count - expectedProcessed &&
        p.logicalFailures === 0 &&
        p.unexpectedHttp === 0,
      'Unexpected workload outcome',
    );
    p.reconciliation = await reconcile(wallets, BigInt(plan.amount.replace('.', '')));
    p.audit = await audit(wallets, commands, expectedProcessed, plan.count - expectedProcessed);
    for (const item of history) {
      const replay = await send(item.command, (item.replica + 1) % 3, p);
      check(
        replay.idempotentReplay &&
          replay.transactionId === item.result.transactionId &&
          replay.status === item.result.status &&
          replay.balance.amount === item.result.balance.amount,
        'Historical replay differs',
      );
      p.replayChecks++;
    }
    if (p.name === 'replica-loss') {
      const status = (await Bun.file('test-results/distributed-crash.json').json()) as {
        restarted: boolean;
      };
      check(
        status.restarted && p.transportErrors > 0,
        'Real replica loss did not occur during traffic',
      );
      await ready();
    }
    p.passed = true;
    console.log(
      JSON.stringify({
        phase: p.name,
        passed: p.passed,
        requests: p.uniqueCommands,
        processed: p.processed,
        rejected: p.rejected,
        throughput: p.throughput,
        transportErrors: p.transportErrors,
        recoverySeconds: p.recoverySeconds,
      }),
    );
  } catch (error) {
    p.error = String(error);
    throw error;
  } finally {
    p.completedAt = new Date().toISOString();
    await Bun.write('test-results/distributed-load.json', JSON.stringify(report, null, 2));
  }
}

await Bun.write('test-results/distributed-resource.json', JSON.stringify({ resourceId }));
const monitor = (async () => {
  while (monitoring) {
    await capture();
    if (monitoring) await Bun.sleep(2000);
  }
})();
try {
  await ready();
  report.sqlSessions = await db.em
    .fork()
    .execute<{ pid: number; address: string; usename: string }[]>(
      "SELECT pid,client_addr::text address,usename FROM pg_stat_activity WHERE datname=current_database() AND usename='wagering_app'",
    );
  const addresses = new Set((report.sqlSessions as { address: string }[]).map((s) => s.address));
  check(addresses.size === 3, 'Three independent replica SQL client addresses were not found');
  if (game) {
    report.game = await runGameLoad({
      resourceId,
      smoke: profile === 'game-smoke',
      urls,
      db,
      walletSet,
      setPhase: (name) => {
        phaseName = name;
      },
      control,
      drain: () => drain(0),
    });
  } else {
    await runPhase({ name: 'warmup', count: 24, clients: 6, wallets: 3, amount: '0.01' }, true);
    for (const plan of plans) await runPhase(plan);
  }
  for (let replica = 0; !game && replica < 3; replica++) {
    const records = samples.filter(
      (s) => s.replica === replica && s.phase.startsWith('http-sqs-duplicates'),
    );
    check(
      records.some((s) => (s.sqsCount ?? 0) > 0) &&
        records.some((s) => (s.publisherAccepted ?? 0) > 0),
      `Replica ${replica + 1} did not consume and publish`,
    );
  }
  const [auditRow] = await db.em.fork().execute<Record<string, string>[]>(`SELECT
    (SELECT count(*) FROM wallets)::text wallets,
    (SELECT count(*) FROM failed_deliveries)::text failed,
    (SELECT count(*) FROM outbox WHERE published_at IS NULL)::text pending,
    (SELECT count(*) FROM wager_transactions WHERE status IN ('PENDING','PENDING_REFERENCE','FAILED'))::text nonterminal,
    (SELECT count(*) FROM wallets w WHERE balance<>(SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0) FROM wallet_ledger l WHERE l.wallet_id=w.id) OR version<>(SELECT count(*) FROM wallet_ledger l WHERE l.wallet_id=w.id))::text inconsistent,
    (SELECT count(*) FROM accounting_journals j WHERE (SELECT count(*) FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>2 OR (SELECT sum(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END) FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>0)::text unbalanced,
    (SELECT count(*) FROM inbox)::text inbox,
    (SELECT count(*) FROM outbox)::text events,
    (SELECT count(*) FROM wager_transactions)::text transactions,
    (SELECT count(*) FROM wallet_ledger)::text ledger`);
  report.finalAudit = auditRow!;
  check(
    Number(auditRow!.wallets) === allWallets &&
      ['failed', 'pending', 'nonterminal', 'inconsistent', 'unbalanced'].every(
        (k) => auditRow![k] === '0',
      ),
    'Global SQL audit failed',
  );
  check(
    samples.every(
      (s) =>
        !s.error ||
        s.phase === 'startup' ||
        ((s.phase.startsWith('replica-loss') || (game && s.phase.startsWith('game-'))) &&
          s.replica === 0),
    ),
    'Unexpected telemetry collection outage',
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  monitoring = false;
  await monitor;
  report.completedAt = new Date().toISOString();
  await Bun.write('test-results/distributed-load.json', JSON.stringify(report, null, 2));
  await Bun.write('test-results/distributed-attempts.json', JSON.stringify(attempts));
  await Bun.write('test-results/distributed-samples.json', JSON.stringify(samples));
  await control('stop-replicas');
  const deadline = Date.now() + 60000;
  while (
    !(await Bun.file('test-results/distributed-replicas-stopped').exists()) &&
    Date.now() < deadline
  )
    await Bun.sleep(500);
  if (!(await Bun.file('test-results/distributed-replicas-stopped').exists())) {
    process.exitCode = 1;
    console.error('Host did not stop replicas before resource cleanup');
  }
  await db.close(true);
  client.destroy();
  console.log(JSON.stringify({ passed: report.passed, resourceId, error: report.error }));
}
