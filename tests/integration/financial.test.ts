import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { connectDatabase } from '../../src/infrastructure/persistence/database';
import type { Database } from '../../src/infrastructure/persistence/types/database';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { WageringQueries } from '../../src/infrastructure/persistence/queries';
import { WageringService } from '../../src/application/wagering';
import { newId, object, parseCommand } from '../../src/application/contracts';
import { Money } from '../../src/domain/money';
import { FinancialErrorCode } from '../../src/domain/constants/errors';
import { WagerStatus } from '../../src/domain/constants/wager';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { assertReconciled } from '../helpers/reconciliation';
import type { EventEnvelope, TransactionEventData } from '../../src/domain/types/events';

let db: Database;
let service: WageringService;
let queries: WageringQueries;
const ctx = { correlationId: newId() };
const walletIds = new Set<string>();

beforeAll(async () => {
  requireTestIsolation();
  db = await connectDatabase();
  service = new WageringService(new MikroFinancialUnitOfWork(db));
  queries = new WageringQueries(db);
});
afterAll(async () => {
  await db?.close(true);
});

afterEach(async () => {
  await assertReconciled(queries, walletIds);
  walletIds.clear();
});

async function wallet(amount = '100.00') {
  const w = (await service.openWallet(newId(), Money.from({ amount, currency: 'BRL' }), ctx)) as {
    walletId: string;
    playerId: string;
  };

  walletIds.add(w.walletId);

  return { walletId: w.walletId, playerId: w.playerId };
}

function transactionEvents(transactionId: string) {
  return db.em
    .fork()
    .execute<{ event_type: string; payload: EventEnvelope<TransactionEventData> }[]>(
      "SELECT event_type,payload FROM outbox WHERE payload->'data'->>'transactionId'=? ORDER BY event_type",
      [transactionId],
    );
}

function command(
  w: { walletId: string; playerId: string },
  kind = 'BET',
  amount = '25.00',
  ref?: string,
) {
  return parseCommand(
    {
      ...w,
      providerId: 'integration',
      externalTransactionId: newId(),
      roundId: 'round',
      gameId: 'game',
      kind,
      money: { amount, currency: 'BRL' },
      ...(ref ? { referenceExternalTransactionId: ref } : {}),
    },
    newId(),
  );
}

test('opening, debit, historical replay, LOSS, refund and rollback remain coherent', async () => {
  const w = await wallet();
  const bet = command(w);
  const r = await service.process(bet, ctx);

  expect(r.balance.amount).toBe('75.00');

  const loss = await service.process(command(w, 'LOSS', '0.00'), ctx);

  expect(loss.status).toBe(WagerStatus.PROCESSED);
  expect(loss.balance.amount).toBe('75.00');
  expect((await queries.wallet(w.walletId)).version).toBe(2);

  const lossEvents = await transactionEvents(loss.transactionId);

  expect(lossEvents.map((e) => e.event_type)).toEqual(['WagerTransactionProcessed']);
  expect(lossEvents[0]!.payload.data).toMatchObject({
    transactionId: loss.transactionId,
    status: 'PROCESSED',
    balance: loss.balance,
  });
  expect(
    await db.em
      .fork()
      .execute('SELECT id FROM wallet_ledger WHERE transaction_id=?', [loss.transactionId]),
  ).toHaveLength(0);

  const refund = command(w, 'REFUND', '25.00', bet.externalTransactionId);

  await service.process(refund, ctx);

  expect((await service.process(bet, ctx)).balance.amount).toBe('75.00');
  expect(
    (await service.process(command(w, 'ROLLBACK', '25.00', refund.externalTransactionId), ctx))
      .balance.amount,
  ).toBe('75.00');
  expect(
    (await service.process(command(w, 'ROLLBACK', '25.00', bet.externalTransactionId), ctx))
      .failureCode,
  ).toBe(FinancialErrorCode.REFERENCE_ALREADY_REVERSED);

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.consistent).toBe(true);
  expect(recon.checkedEntries).toBe(4);

  const first = await queries.ledger(w.walletId, undefined, 2);
  const second = await queries.ledger(w.walletId, first.nextCursor!, 2);

  expect(first.items.length + second.items.length).toBe(4);
  expect(second.nextCursor).toBeNull();
});

test('ROLLBACK reverses BET and WIN in PostgreSQL with one matching ledger entry each', async () => {
  const w = await wallet();
  const bet = command(w);
  const betResult = await service.process(bet, ctx);
  const rollbackBet = command(w, 'ROLLBACK', '25.00', bet.externalTransactionId);
  const rollbackBetResult = await service.process(rollbackBet, ctx);
  const win = command(w, 'WIN', '10.00');
  const winResult = await service.process(win, ctx);
  const rollbackWin = command(w, 'ROLLBACK', '10.00', win.externalTransactionId);
  const rollbackWinResult = await service.process(rollbackWin, ctx);

  expect(betResult.balance.amount).toBe('75.00');
  expect(rollbackBetResult).toMatchObject({ status: 'PROCESSED', balance: { amount: '100.00' } });
  expect(winResult.balance.amount).toBe('110.00');
  expect(rollbackWinResult).toMatchObject({ status: 'PROCESSED', balance: { amount: '100.00' } });
  expect(
    await db.em
      .fork()
      .execute<{ kind: string; direction: string }[]>(
        `SELECT t.kind,l.direction FROM wager_transactions t JOIN wallet_ledger l ON l.transaction_id=t.id WHERE t.id IN (?,?) ORDER BY l.wallet_version`,
        [rollbackBetResult.transactionId, rollbackWinResult.transactionId],
      ),
  ).toEqual([
    { kind: 'ROLLBACK', direction: 'CREDIT' },
    { kind: 'ROLLBACK', direction: 'DEBIT' },
  ]);
  expect(await service.process(rollbackBet, ctx)).toMatchObject({
    idempotentReplay: true,
    balance: { amount: '100.00' },
  });
  expect(await service.process(rollbackWin, ctx)).toMatchObject({
    idempotentReplay: true,
    balance: { amount: '100.00' },
  });
  expect((await queries.wallet(w.walletId)).version).toBe(5);
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(5);
});

test('WIN can reference a BET that arrives later and applies one credit after recovery', async () => {
  const w = await wallet();
  const bet = command(w);
  const win = command(w, 'WIN', '10.00', bet.externalTransactionId);
  const pending = await service.process(win, ctx);

  expect(pending.status).toBe(WagerStatus.PENDING_REFERENCE);
  expect((await service.process(bet, ctx)).balance.amount).toBe('75.00');

  await service.retryReference(pending.transactionId, win.idempotencyKey, ctx);

  expect(await service.process(win, ctx)).toMatchObject({
    status: 'PROCESSED',
    balance: { amount: '85.00' },
    idempotentReplay: true,
  });
  await service.retryReference(pending.transactionId, win.idempotencyKey, ctx);
  expect((await queries.transaction(pending.transactionId)).balance.amount).toBe('85.00');
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(3);
  expect((await queries.wallet(w.walletId)).version).toBe(3);
});

test('ledger cursor continues without duplicate or missing entries when a write occurs between pages', async () => {
  const w = await wallet();

  for (let i = 0; i < 3; i++) await service.process(command(w, 'BET', '1.00'), ctx);

  const first = await queries.ledger(w.walletId, undefined, 2);

  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).not.toBeNull();

  const insertedBetweenPages = await service.process(command(w, 'BET', '1.00'), ctx);
  const subsequent: Awaited<ReturnType<typeof queries.ledger>>['items'] = [];
  let cursor = first.nextCursor;

  while (cursor) {
    const page = await queries.ledger(w.walletId, cursor, 2);

    subsequent.push(...page.items);
    cursor = page.nextCursor;
  }

  const ledgerIds = [...first.items, ...subsequent].map((entry) => entry.ledgerEntryId);
  const transactionIds = [...first.items, ...subsequent].map((entry) => entry.transactionId);

  expect(ledgerIds).toHaveLength(5);
  expect(new Set(ledgerIds).size).toBe(ledgerIds.length);
  expect(transactionIds).toContain(insertedBetweenPages.transactionId);
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(5);
});

test('same key with different payload conflicts; fifty duplicate requests apply once', async () => {
  const w = await wallet();
  const bet = command(w);
  const results = await Promise.all(Array.from({ length: 50 }, () => service.process(bet, ctx)));

  expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(2);
  await expect(
    service.process({ ...bet, money: { amount: '26.00', currency: 'BRL' } }, ctx),
  ).rejects.toMatchObject({ status: 409 });
});

test('two simultaneous debits of 80 from 100 permit exactly one', async () => {
  const w = await wallet();

  const results = await Promise.all([
    service.process(command(w, 'BET', '80.00'), ctx),
    service.process(command(w, 'BET', '80.00'), ctx),
  ]);

  expect(results.filter((r) => r.status === WagerStatus.PROCESSED)).toHaveLength(1);
  expect(results.filter((r) => r.status === WagerStatus.REJECTED)).toHaveLength(1);

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.storedBalance.amount).toBe('20.00');
  expect(recon.consistent).toBe(true);
  expect(recon.checkedEntries).toBe(2);
});

test('ORM persists a one-cent change above the floating-point precision boundary', async () => {
  const w = await wallet('900719925474099.01');
  const credit = await service.process(command(w, 'WIN', '0.01'), ctx);

  expect(credit.balance.amount).toBe('900719925474099.02');

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.storedBalance.amount).toBe('900719925474099.02');
  expect(recon.consistent).toBe(true);
});

test('failure before commit rolls back wallet, transaction, ledger, inbox and outbox', async () => {
  const w = await wallet();
  const bet = command(w);
  const messageId = newId();
  const before = await queries.wallet(w.walletId);
  const outboxBefore = await db.em
    .fork()
    .execute('SELECT id,payload FROM outbox WHERE aggregate_id=? ORDER BY id', [w.walletId]);

  const crashing = new WageringService(new MikroFinancialUnitOfWork(db), undefined, {
    beforeCommit: () => {
      throw new Error('simulated crash');
    },
  });

  await expect(crashing.process(bet, { ...ctx, consumerName: 'test', messageId })).rejects.toThrow(
    'simulated crash',
  );
  expect(await queries.byKey(bet.idempotencyKey)).toBeNull();
  expect(await queries.wallet(w.walletId)).toEqual(before);
  expect(
    await db.em
      .fork()
      .execute('SELECT message_id FROM inbox WHERE consumer_name=? AND message_id=?', [
        'test',
        messageId,
      ]),
  ).toHaveLength(0);
  expect(
    await db.em
      .fork()
      .execute('SELECT id,payload FROM outbox WHERE aggregate_id=? ORDER BY id', [w.walletId]),
  ).toEqual(outboxBefore);
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(1);

  const committed = await service.process(bet, { ...ctx, consumerName: 'test', messageId });

  expect(committed.status).toBe(WagerStatus.PROCESSED);
  expect(
    await db.em
      .fork()
      .execute('SELECT transaction_id FROM inbox WHERE consumer_name=? AND message_id=?', [
        'test',
        messageId,
      ]),
  ).toEqual([{ transaction_id: committed.transactionId }]);
  expect((await transactionEvents(committed.transactionId)).map((e) => e.event_type)).toEqual([
    'WagerTransactionProcessed',
    'WalletBalanceChanged',
  ]);
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(2);
});

test('pending reference survives reconnect, resolves after parent and expires using injected clock', async () => {
  const w = await wallet();
  const bet = command(w);
  const refund = command(w, 'REFUND', '25.00', bet.externalTransactionId);
  const pending = await service.process(refund, ctx);

  expect(pending.status).toBe(WagerStatus.PENDING_REFERENCE);

  const anotherDb = await connectDatabase();

  try {
    await service.process(bet, ctx);
    await new WageringService(new MikroFinancialUnitOfWork(anotherDb)).retryReference(
      pending.transactionId,
      refund.idempotencyKey,
      ctx,
    );
  } finally {
    await anotherDb.close(true);
  }

  expect((await queries.transaction(pending.transactionId)).status).toBe(WagerStatus.PROCESSED);

  const absent = command(w, 'REFUND', '25.00', newId());
  const waiting = await service.process(absent, ctx);
  const beforeExpiry = await queries.wallet(w.walletId);

  await new WageringService(new MikroFinancialUnitOfWork(db), {
    now: () => new Date(Date.now() + 1_000_000),
  }).retryReference(waiting.transactionId, absent.idempotencyKey, ctx);

  const expired = await queries.transaction(waiting.transactionId);

  expect(expired).toMatchObject({
    status: 'REJECTED',
    failureCode: 'REFERENCE_NOT_FOUND',
    balance: beforeExpiry.balance,
  });
  expect(await queries.wallet(w.walletId)).toEqual(beforeExpiry);
  expect(
    await db.em
      .fork()
      .execute('SELECT id FROM wallet_ledger WHERE transaction_id=?', [waiting.transactionId]),
  ).toHaveLength(0);

  const expiryEvents = await transactionEvents(waiting.transactionId);

  expect(expiryEvents.map((e) => e.event_type)).toEqual([
    'WagerTransactionPendingReference',
    'WagerTransactionRejected',
  ]);
  expect(expiryEvents[1]!.payload.data).toMatchObject({
    status: 'REJECTED',
    failureCode: 'REFERENCE_NOT_FOUND',
    balance: beforeExpiry.balance,
  });
  expect(await service.process(absent, ctx)).toMatchObject({
    status: 'REJECTED',
    failureCode: 'REFERENCE_NOT_FOUND',
    idempotentReplay: true,
  });
  await service.retryReference(waiting.transactionId, absent.idempotencyKey, ctx);

  expect(await transactionEvents(waiting.transactionId)).toEqual(expiryEvents);
});

test('SQL and application role forbid balance corruption and ledger mutation', async () => {
  const w = await wallet();

  await expect(
    db.em.fork().execute('UPDATE wallets SET balance=balance+1 WHERE id=?', [w.walletId]),
  ).rejects.toThrow();
  await expect(
    db.em.fork().execute('UPDATE wallet_ledger SET amount=1 WHERE wallet_id=?', [w.walletId]),
  ).rejects.toThrow();
  await expect(
    db.em.fork().execute('DELETE FROM wallet_ledger WHERE wallet_id=?', [w.walletId]),
  ).rejects.toThrow();
  await expect(db.em.fork().execute('TRUNCATE wallet_ledger CASCADE')).rejects.toThrow();
  expect((await queries.reconciliation(w.walletId)).consistent).toBe(true);
});

test('a processed transaction without its ledger is rejected at SQL commit, and terminal state is immutable', async () => {
  const w = await wallet();
  const c = command(w);
  const id = newId();

  await expect(
    db.em.fork().execute(
      `INSERT INTO wager_transactions(id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,status,result,created_at,processed_at,next_attempt_at)
    VALUES (?,?,?,?,?,?,?,?,?,'BET',1.00,'BRL','PROCESSED',?::jsonb,now(),now(),now())`,
      [
        id,
        c.providerId,
        c.externalTransactionId,
        c.idempotencyKey,
        'a'.repeat(64),
        w.walletId,
        w.playerId,
        c.roundId,
        c.gameId,
        JSON.stringify({
          transactionId: id,
          status: 'PROCESSED',
          balance: { amount: '99.00', currency: 'BRL' },
        }),
      ],
    ),
  ).rejects.toThrow();
  expect(await queries.byKey(c.idempotencyKey)).toBeNull();

  const result = await service.process(c, ctx);

  await expect(
    db.em
      .fork()
      .execute("UPDATE wager_transactions SET status='FAILED',failure_code='test' WHERE id=?", [
        result.transactionId,
      ]),
  ).rejects.toThrow();
  await expect(
    db.em.fork().execute('ALTER TABLE wallet_ledger DISABLE TRIGGER ALL'),
  ).rejects.toThrow();
});

test('SQL rejects a terminal LOSS replay balance that disagrees with its historical wallet version', async () => {
  const w = await wallet();
  const c = command(w, 'LOSS', '0.00');
  const transactionId = newId();

  await expect(
    db.em.fork().execute(
      `INSERT INTO wager_transactions(id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,status,result,created_at,processed_at,next_attempt_at)
      VALUES (?,?,?,?,?,?,?,?,?,'LOSS',0.00,'BRL','PROCESSED',?::jsonb,now(),now(),now())`,
      [
        transactionId,
        c.providerId,
        c.externalTransactionId,
        c.idempotencyKey,
        'b'.repeat(64),
        w.walletId,
        w.playerId,
        c.roundId,
        c.gameId,
        JSON.stringify({
          transactionId,
          status: 'PROCESSED',
          balance: { amount: '99.00', currency: 'BRL' },
          snapshotVersion: 1,
        }),
      ],
    ),
  ).rejects.toThrow();

  expect(await queries.byKey(c.idempotencyKey)).toBeNull();
  expect((await queries.reconciliation(w.walletId)).storedBalance.amount).toBe('100.00');
});

test('temporary tables cannot shadow the real ledger audit when using the application role', async () => {
  const w = await wallet();

  await expect(
    db.em.fork().transactional(async (em) => {
      await em.execute('CREATE TEMP TABLE wallets (LIKE public.wallets)');
      await em.execute('INSERT INTO pg_temp.wallets SELECT * FROM public.wallets WHERE id=?', [
        w.walletId,
      ]);
      // The temp wallet contains the old valid balance. The trigger must read the updated public wallet.
      await em.execute('UPDATE public.wallets SET balance=balance+1 WHERE id=?', [w.walletId]);
    }),
  ).rejects.toThrow();

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.consistent).toBe(true);
  expect(recon.storedBalance.amount).toBe('100.00');
});

test('reference mismatch, partial reversal, WIN rollback without funds and historical rejection', async () => {
  const first = await wallet();
  const second = await wallet();
  const bet = command(first);

  await service.process(bet, ctx);

  expect(
    (await service.process(command(second, 'REFUND', '25.00', bet.externalTransactionId), ctx))
      .failureCode,
  ).toBe(FinancialErrorCode.REFERENCE_CONTEXT_MISMATCH);
  expect(
    (await service.process(command(first, 'REFUND', '24.00', bet.externalTransactionId), ctx))
      .failureCode,
  ).toBe(FinancialErrorCode.REFERENCE_AMOUNT_MISMATCH);

  const empty = await wallet('0.00');
  const win = command(empty, 'WIN', '40.00');

  await service.process(win, ctx);
  await service.process(command(empty, 'BET', '40.00'), ctx);

  const rollback = command(empty, 'ROLLBACK', '40.00', win.externalTransactionId);
  const denied = await service.process(rollback, ctx);

  expect(denied.failureCode).toBe(FinancialErrorCode.REVERSAL_INSUFFICIENT_FUNDS);
  expect(denied.balance.amount).toBe('0.00');

  await service.process(command(empty, 'WIN', '50.00'), ctx);

  expect((await service.process(rollback, ctx)).balance.amount).toBe('0.00');
  expect((await queries.reconciliation(empty.walletId)).storedBalance.amount).toBe('50.00');
});

test('unique external identity and global idempotency key also hold across different wallets', async () => {
  const first = await wallet();
  const second = await wallet();
  const c = command(first);

  const attempts = await Promise.allSettled([
    service.process(c, ctx),
    service.process(
      { ...c, walletId: second.walletId, playerId: second.playerId, idempotencyKey: newId() },
      ctx,
    ),
  ]);

  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

  const rejected = attempts.find((r) => r.status === 'rejected') as PromiseRejectedResult;

  expect(object(rejected.reason as unknown).status).toBe(409);
  await expect(
    service.process({ ...c, walletId: second.walletId, playerId: second.playerId }, ctx),
  ).rejects.toMatchObject({ status: 409 });
  expect((await queries.reconciliation(first.walletId)).consistent).toBe(true);
  expect((await queries.reconciliation(second.walletId)).consistent).toBe(true);
});

test('two different refunds racing for one BET produce one processed credit and one rejection', async () => {
  const w = await wallet();
  const bet = command(w);

  await service.process(bet, ctx);

  const results = await Promise.all([
    service.process(command(w, 'REFUND', '25.00', bet.externalTransactionId), ctx),
    service.process(command(w, 'REFUND', '25.00', bet.externalTransactionId), ctx),
  ]);

  expect(results.map((r) => r.status).sort()).toEqual([
    WagerStatus.PROCESSED,
    WagerStatus.REJECTED,
  ]);

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.consistent).toBe(true);
  expect(recon.storedBalance.amount).toBe('100.00');
  expect(recon.checkedEntries).toBe(3);
});

test('a REFUND blocks a direct ROLLBACK of the same BET without another financial effect', async () => {
  const w = await wallet();
  const bet = command(w);

  await service.process(bet, ctx);
  await service.process(command(w, 'REFUND', '25.00', bet.externalTransactionId), ctx);

  const before = await queries.wallet(w.walletId);
  const ledgerBefore = await db.em
    .fork()
    .execute<{ id: string; transaction_id: string; direction: string; amount: string }[]>(
      'SELECT id,transaction_id,direction,amount FROM wallet_ledger WHERE wallet_id=? ORDER BY id',
      [w.walletId],
    );
  const rollback = await service.process(
    command(w, 'ROLLBACK', '25.00', bet.externalTransactionId),
    ctx,
  );

  expect(rollback).toMatchObject({
    status: 'REJECTED',
    failureCode: 'REFERENCE_ALREADY_REVERSED',
    balance: { amount: '100.00' },
  });
  expect(await queries.wallet(w.walletId)).toMatchObject({
    balance: before.balance,
    version: before.version,
  });
  expect(
    await db.em
      .fork()
      .execute(
        'SELECT id,transaction_id,direction,amount FROM wallet_ledger WHERE wallet_id=? ORDER BY id',
        [w.walletId],
      ),
  ).toEqual(ledgerBefore);
  expect((await transactionEvents(rollback.transactionId)).map((e) => e.event_type)).toEqual([
    'WagerTransactionRejected',
  ]);

  const recon = await queries.reconciliation(w.walletId);

  expect(recon).toMatchObject({
    consistent: true,
    storedBalance: { amount: '100.00' },
    checkedEntries: 3,
  });
});

test('reconciliation snapshots remain consistent during concurrent writes', async () => {
  const w = await wallet();

  const snapshots = await Promise.all([
    Promise.all(Array.from({ length: 20 }, () => service.process(command(w, 'WIN', '0.01'), ctx))),
    Promise.all(Array.from({ length: 50 }, () => queries.reconciliation(w.walletId))),
  ]);

  expect(snapshots[1].every((r) => r.consistent)).toBe(true);
  expect((await queries.reconciliation(w.walletId)).storedBalance.amount).toBe('100.20');
});
