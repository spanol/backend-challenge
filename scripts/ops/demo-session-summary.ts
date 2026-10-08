import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { object } from '../../src/application/contracts';
import { Money } from '../../src/domain/money';
import { connectDatabase } from '../../src/infrastructure/persistence/database';
import { acquireDemoLock, FileJournal } from '../../demo/journal';
import { summarizeSession } from '../../demo/session-summary';

const mode = Bun.argv[2];
const journalPath = Bun.argv[3];
if (!['capture', 'apply'].includes(mode ?? '') || !journalPath)
  throw new Error('Usage: demo-session-summary.ts capture|apply JOURNAL [BASELINE]');

// Operator utility: pause autoplay, wait for settlement, stop the coordinator,
// and back up the journal before running either mode. No financial commands.
const journal = new FileJournal(journalPath);
const source = await readFile(journalPath, 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
const state = await journal.load();
if (
  !state ||
  state.autoplay?.enabled ||
  state.operations.some((op) => !op.result && !op.expiredBeforeSend) ||
  state.bets.some((bet) => bet.status === 'active' || bet.status === 'placing') ||
  state.admissionError ||
  state.settlementError ||
  state.walletRenewalError
)
  throw new Error('A settled, paused session is required; the journal was not changed');

function counter(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Invalid outcome count');
  return parsed;
}

if (mode === 'capture') {
  if (state.renewedWalletCount)
    throw new Error('Historical wallet renewal requires a broader audit; no baseline captured');
  const walletIds = [...new Set([...state.peers, ...state.pendingPeers].map((p) => p.walletId))];
  if (!walletIds.length) throw new Error('Session has no wallets');
  const db = await connectDatabase();
  const connection = db.em.getConnection();
  try {
    const context = await connection.begin();
    try {
      await connection.execute('SET TRANSACTION READ ONLY', [], 'run', context);
      await connection.execute("SET LOCAL statement_timeout = '15s'", [], 'run', context);
      // Use the existing wallet index for this session, not the entire archive.
      await connection.execute('SET LOCAL enable_indexscan = off', [], 'run', context);
      const [row] = await connection.execute<Record<string, string>[]>(
        `SELECT count(*) FILTER (WHERE kind='WIN')::text cashed,
                count(*) FILTER (WHERE kind='LOSS')::text lost,
                coalesce(sum(amount) FILTER (WHERE kind='WIN'),0.00)::text paid
           FROM wager_transactions
          WHERE provider_id=? AND external_transaction_id LIKE ?
            AND wallet_id IN (${walletIds.map(() => '?').join(',')})
            AND status='PROCESSED' AND kind IN ('WIN','LOSS')`,
        ['decolagem-demo', `${state.sessionId}:%`, ...walletIds],
        'all',
        context,
      );
      if (!row) throw new Error('Missing aggregate result');
      console.log(
        JSON.stringify({
          version: 1,
          sessionId: state.sessionId,
          journalSha256: sourceHash,
          capturedAt: new Date().toISOString(),
          walletCount: walletIds.length,
          cashed: counter(row.cashed),
          lost: counter(row.lost),
          paid: Money.from({ amount: row.paid!, currency: 'BRL' }).toString(),
        }),
      );
    } finally {
      await connection.rollback(context);
    }
  } finally {
    await db.close(true);
  }
} else {
  const baselinePath = Bun.argv[4];
  if (!baselinePath) throw new Error('A captured baseline file is required');
  const baseline = object(JSON.parse(await readFile(baselinePath, 'utf8')) as unknown);
  if (
    baseline.version !== 1 ||
    baseline.sessionId !== state.sessionId ||
    baseline.journalSha256 !== sourceHash
  )
    throw new Error('The baseline belongs to another journal revision; nothing was changed');
  const retained = summarizeSession({ ...state, history: undefined });
  const cashed = counter(baseline.cashed) - retained.cashed;
  const lost = counter(baseline.lost) - retained.lost;
  const paid = Money.from({ amount: String(baseline.paid), currency: 'BRL' }).subtract(
    Money.from({ amount: retained.paid, currency: 'BRL' }),
  );
  if (cashed < 0 || lost < 0 || paid.isNegative())
    throw new Error('The database totals do not cover retained outcomes; nothing was changed');

  const unlock = await acquireDemoLock(`${journalPath}.lock`);
  try {
    if (
      createHash('sha256')
        .update(await readFile(journalPath, 'utf8'))
        .digest('hex') !== sourceHash
    )
      throw new Error('Journal changed before the write; nothing was changed');
    state.history ??= { operationCount: 0, completedOperationCount: 0, apiOperationCounts: {} };
    state.history.outcomes = { cashed, lost, paid: paid.toString(), complete: true };
    await journal.save(state);
    console.log(JSON.stringify({ sessionId: state.sessionId, summary: summarizeSession(state) }));
  } finally {
    await unlock();
  }
}
