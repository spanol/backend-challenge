import { createHash } from 'node:crypto';
import { newId } from '../src/application/contracts';
import type { ProcessingResult } from '../src/application/types/wagering';
import { WagerKind, WagerStatus } from '../src/domain/constants/wager';
import type { WagerCommand } from '../src/domain/types/wager';
import type { Database } from '../src/infrastructure/persistence/types/database';
import type { LoadWallet } from './types/distributed-load';
import type {
  Arrival,
  GameAttempt,
  GamePhase,
  GameTransactionRow,
  GameWalletRow,
} from './types/game-load';
import { percentiles, runArrivals } from './game-arrivals';

export async function runGameLoad(options: {
  resourceId: string;
  smoke: boolean;
  urls: string[];
  db: Database;
  walletSet: (count: number, hot: boolean) => Promise<LoadWallet[]>;
  setPhase: (name: string) => void;
  control: (action: string) => Promise<void>;
  drain: () => Promise<number>;
}) {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] || fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const population = integer('GAME_LOAD_PEERS', options.smoke ? 96 : 38000, 3, 100000);
  const concurrency = integer('GAME_LOAD_CONCURRENCY', options.smoke ? 24 : 512, 1, 4096);
  const durationMs = integer('GAME_LOAD_STAGE_SECONDS', options.smoke ? 6 : 180, 6, 600) * 1000;
  const maxWaitMs = integer('GAME_LOAD_MAX_WAIT_MS', options.smoke ? 3000 : 20000, 100, 60000);
  const reuse = process.env.GAME_LOAD_CONNECTION_REUSE !== 'false';
  const attempts: GameAttempt[] = [];
  const submitted: WagerCommand[] = [];
  const acknowledged = new Set<string>();
  const phases: GamePhase[] = [];
  const report = {
    resourceId: options.resourceId,
    startedAt: new Date().toISOString(),
    completedAt: '',
    population,
    concurrency,
    maxWaitMs,
    connectionReuse: reuse,
    methodology: {
      arrivals: 'Clock driven; full population offered in burst; bounded generator queue',
      population: 'Independent persistent wallets reused across phases; not WebSocket connections',
      game: 'BET 0.01 followed by deterministic 40% WIN 0.02 referencing BET / 60% LOSS in the same round',
      rounds: 'Virtual player sessions; not the visual DemoTable coordinator',
      thinkTimeMs: '200–500, deterministic per arrival',
      requestTimeoutMs: 8000,
      retries: 0,
      failure: 'SIGKILL replica-1 halfway through sustained stage; restart after five seconds',
      capacitySloMs: 2000,
      outcome: 'Experiment completion and financial integrity do not imply each stage met capacity',
    },
    phases,
    recoverySeconds: 0,
    sqlAudit: {} as Record<string, number | boolean>,
    passed: false,
    error: undefined as string | undefined,
  };
  const save = () =>
    Bun.write('test-results/distributed-game.json', JSON.stringify(report, null, 2));
  options.setPhase('game-provisioning');
  await save();
  const wallets = await options.walletSet(population, false);
  await Bun.write(
    'test-results/game-population.json',
    JSON.stringify(wallets.map((w) => ({ walletId: w.walletId, playerId: w.playerId }))),
  );

  function makeCommand(
    wallet: LoadWallet,
    phase: string,
    sequence: number,
    kind: WagerCommand['kind'],
    bet?: WagerCommand,
  ): WagerCommand {
    return {
      walletId: wallet.walletId,
      playerId: wallet.playerId,
      providerId: 'distributed-game',
      externalTransactionId: newId(),
      idempotencyKey: newId(),
      roundId: bet?.roundId ?? `${options.resourceId}-${phase}-${sequence}`,
      gameId: 'decolagem-load',
      kind,
      money: { amount: kind === WagerKind.WIN ? '0.02' : '0.01', currency: 'BRL' },
      ...(bet && kind === WagerKind.WIN
        ? { referenceExternalTransactionId: bet.externalTransactionId }
        : {}),
    };
  }

  async function send(command: WagerCommand, replica: number, phase: GamePhase): Promise<boolean> {
    submitted.push(command);
    const { idempotencyKey, ...body } = command;
    const start = performance.now();
    const attempt: GameAttempt = {
      phase: phase.name,
      replica,
      key: idempotencyKey,
      kind: command.kind,
      at: new Date().toISOString(),
      elapsedMs: 0,
    };
    phase.replicas[replica] = (phase.replicas[replica] ?? 0) + 1;
    try {
      const response = await fetch(`${options.urls[replica]}/wagering/transactions`, {
        keepalive: reuse,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Correlation-Id': idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      attempt.status = response.status;
      phase.responses++;
      if (response.status !== 200) {
        if (response.status === 422) phase.rejected++;
        else phase.unexpectedHttp++;
        await response.text();
        return false;
      }
      const result = (await response.json()) as ProcessingResult;
      if (result.status !== WagerStatus.PROCESSED) {
        phase.unexpectedHttp++;
        return false;
      }
      acknowledged.add(idempotencyKey);
      return true;
    } catch (error) {
      attempt.error = String(error);
      phase.transportErrors++;
      return false;
    } finally {
      attempt.elapsedMs = performance.now() - start;
      attempts.push(attempt);
    }
  }

  const baseRate = options.smoke ? 4 : 30;
  const plans = [
    { name: 'game-ramp', rate: baseRate, duration: durationMs / 3, burst: false },
    { name: 'game-sustained', rate: baseRate * 2, duration: durationMs, burst: false },
    { name: 'game-burst-all', rate: 0, duration: options.smoke ? 3000 : 30000, burst: true },
    { name: 'game-recovery', rate: baseRate, duration: durationMs / 2, burst: false },
  ];
  let playerCursor = 0;
  let sequence = 0;
  let crashSent = false;
  const busy = new Set<number>();
  try {
    for (const plan of plans) {
      options.setPhase(plan.name);
      const phase: GamePhase = {
        name: plan.name,
        population,
        arrivalsPerSecond: plan.burst ? null : plan.rate,
        arrivalWindowMs: plan.duration,
        startedAt: new Date().toISOString(),
        sessionsCompleted: 0,
        responses: 0,
        transportErrors: 0,
        unexpectedHttp: 0,
        rejected: 0,
        replicas: [0, 0, 0],
      };
      phases.push(phase);
      const arrivals: Arrival[] = Array.from(
        { length: plan.burst ? population : Math.floor((plan.rate * plan.duration) / 1000) },
        (_, i) => ({
          player: plan.burst ? i : playerCursor++ % population,
          dueMs: plan.burst ? 0 : (i * 1000) / plan.rate,
        }),
      );
      await Bun.write(`test-results/arrivals-${plan.name}.json`, JSON.stringify(arrivals));
      const durations: number[] = [];
      const start = performance.now();
      const crash =
        plan.name === 'game-sustained'
          ? (async () => {
              await Bun.sleep(plan.duration / 2);
              crashSent = true;
              await options.control('kill-replica-1');
            })()
          : Promise.resolve();
      const work = runArrivals(
        arrivals,
        { concurrency, maxQueued: population, maxWaitMs, windowMs: plan.duration },
        async (arrival, index) => {
          if (busy.has(arrival.player))
            throw new Error('Player already has an outstanding session');
          busy.add(arrival.player);
          try {
            const wallet = wallets[arrival.player]!;
            const bet = makeCommand(wallet, plan.name, sequence++, WagerKind.BET);
            if (!(await send(bet, index % 3, phase))) return;
            await Bun.sleep(200 + (index % 301));
            const settlement = makeCommand(
              wallet,
              plan.name,
              sequence++,
              index % 5 < 2 ? WagerKind.WIN : WagerKind.LOSS,
              bet,
            );
            if (await send(settlement, (index + 1) % 3, phase)) {
              phase.sessionsCompleted++;
              durations.push(performance.now() - start - arrival.dueMs);
            }
          } finally {
            busy.delete(arrival.player);
          }
        },
      );
      const result = await Promise.allSettled([work, crash]);
      const scheduled = result[0];
      if (scheduled.status === 'rejected') throw scheduled.reason;
      if (result[1].status === 'rejected') throw result[1].reason;
      phase.arrivalStats = scheduled.value;
      phase.sessionLatencyMs = percentiles(durations);
      phase.capacityMet =
        phase.sessionsCompleted === arrivals.length &&
        phase.transportErrors === 0 &&
        phase.unexpectedHttp === 0 &&
        phase.rejected === 0 &&
        phase.sessionLatencyMs.p95 <= 2000;
      phase.completedAt = new Date().toISOString();
      await save();
      if (
        attempts.some(
          (a) =>
            a.phase === plan.name &&
            a.status !== undefined &&
            a.status >= 400 &&
            a.status < 500 &&
            a.status !== 422,
        )
      )
        throw new Error('Invalid/conflicting workload command; this stage cannot prove capacity');
      console.log(
        JSON.stringify({
          phase: plan.name,
          offered: arrivals.length,
          completed: phase.sessionsCompleted,
          expired: scheduled.value.expired,
          transportErrors: phase.transportErrors,
          capacityMet: phase.capacityMet,
        }),
      );
    }
    options.setPhase('game-drain');
    report.recoverySeconds = await options.drain();
    const crash = (await Bun.file('test-results/distributed-crash.json').json()) as {
      restarted: boolean;
    };
    if (!crashSent || !crash.restarted)
      throw new Error('Planned replica loss/restart was not completed');
    options.setPhase('game-audit');
    const rows = await options.db.em.fork().execute<GameTransactionRow[]>(
      `SELECT idempotency_key key,wallet_id::text wallet,player_id::text player,provider_id provider,
      external_transaction_id external,round_id round,game_id game,kind,amount::text amount,currency,
      reference_external_transaction_id reference,status FROM wager_transactions WHERE kind<>'OPENING'`,
    );
    const commands = new Map(submitted.map((c) => [c.idempotencyKey, c]));
    const persisted = new Set(rows.map((row) => row.key));
    if ([...acknowledged].some((key) => !persisted.has(key)))
      throw new Error('Acknowledged command is missing from SQL');
    const expected = new Map(
      wallets.map((w) => [w.walletId, { balance: w.initialCents, entries: 1 }]),
    );
    let processed = 0;
    const bets = new Set<string>();
    const outcomes = new Set<string>();
    for (const row of rows) {
      const command = commands.get(row.key);
      if (
        !command ||
        command.walletId !== row.wallet ||
        command.playerId !== row.player ||
        command.providerId !== row.provider ||
        command.externalTransactionId !== row.external ||
        command.roundId !== row.round ||
        command.gameId !== row.game ||
        command.kind !== row.kind ||
        command.money.amount !== row.amount ||
        command.money.currency !== row.currency ||
        (command.referenceExternalTransactionId ?? null) !== row.reference
      )
        throw new Error('Persisted command differs from submitted plan');
      if (row.status !== WagerStatus.PROCESSED && row.status !== WagerStatus.REJECTED)
        throw new Error('Non-terminal financial operation after drain');
      if (row.status === WagerStatus.PROCESSED) {
        processed++;
        const session = `${row.wallet}:${row.round}`;
        if (row.kind === WagerKind.BET) bets.add(session);
        else if (row.kind === WagerKind.WIN || row.kind === WagerKind.LOSS) outcomes.add(session);
        const wallet = expected.get(row.wallet)!;
        const amount = BigInt(command.money.amount.replace('.', ''));
        if (command.kind === WagerKind.BET) {
          wallet.balance -= amount;
          wallet.entries++;
        }
        if (command.kind === WagerKind.WIN) {
          wallet.balance += amount;
          wallet.entries++;
        }
      }
    }
    const balances = await options.db.em.fork().execute<GameWalletRow[]>(
      `SELECT w.id::text,w.balance::text,w.version,
      COALESCE(sum(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END),0)::text calculated,
      count(l.id)::text entries FROM wallets w LEFT JOIN wallet_ledger l ON l.wallet_id=w.id GROUP BY w.id`,
    );
    if (balances.length !== population) throw new Error('Population cardinality differs');
    for (const wallet of balances) {
      const planned = expected.get(wallet.id)!;
      const decimal = `${planned.balance / 100n}.${String(planned.balance % 100n).padStart(2, '0')}`;
      if (
        wallet.balance !== decimal ||
        wallet.calculated !== decimal ||
        wallet.version !== planned.entries ||
        Number(wallet.entries) !== planned.entries
      )
        throw new Error(`Balance/ledger/version mismatch ${wallet.id}`);
    }
    const [accounting] = await options.db.em
      .fork()
      .execute<{ unbalanced: string; missing: string; pending: string; failed: string }[]>(
        `SELECT
      (SELECT count(*) FROM accounting_journals j WHERE (SELECT count(*) FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>2 OR (SELECT sum(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END) FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>0)::text unbalanced,
      (SELECT count(*) FROM wallet_ledger l LEFT JOIN accounting_journals j ON j.transaction_id=l.transaction_id WHERE j.transaction_id IS NULL)::text missing,
      (SELECT count(*) FROM outbox WHERE published_at IS NULL)::text pending,
      (SELECT count(*) FROM failed_deliveries)::text failed`,
      );
    if (Object.values(accounting!).some((v) => v !== '0'))
      throw new Error('Accounting/publication audit failed');
    report.sqlAudit = {
      wallets: balances.length,
      submitted: submitted.length,
      persisted: rows.length,
      processed,
      absentCommands: submitted.length - rows.length,
      persistedWithoutResponse: rows.filter((row) => !acknowledged.has(row.key)).length,
      betsWithoutOutcome: [...bets].filter((session) => !outcomes.has(session)).length,
      financialIntegrity: true,
    };
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    const savedPlan = JSON.stringify(submitted);
    await Bun.write('test-results/game-commands.json', savedPlan);
    await Bun.write(
      'test-results/game-plan.sha256',
      createHash('sha256').update(savedPlan).digest('hex'),
    );
    await Bun.write('test-results/game-attempts.json', JSON.stringify(attempts));
    report.completedAt = new Date().toISOString();
    await save();
  }
  return report;
}
