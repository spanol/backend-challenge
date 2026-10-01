import { afterAll, beforeAll, expect, test } from 'bun:test';
import { connectDatabase } from '../../src/infrastructure/persistence/database';
import type { Database } from '../../src/infrastructure/persistence/types/database';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { WageringQueries } from '../../src/infrastructure/persistence/queries';
import { WageringService } from '../../src/application/wagering';
import { newId, object, parseCommand } from '../../src/application/contracts';
import { Money } from '../../src/domain/money';
import { requireTestIsolation } from '../helpers/isolated-environment';

let db: Database;
let service: WageringService;
let queries: WageringQueries;
const ctx = { correlationId: newId() };

beforeAll(async () => {
  requireTestIsolation();
  db = await connectDatabase();
  service = new WageringService(new MikroFinancialUnitOfWork(db));
  queries = new WageringQueries(db);
});
afterAll(async () => {
  await db?.close(true);
});

async function wallet(amount = '100.00') {
  const w = (await service.openWallet(newId(), Money.from({ amount, currency: 'BRL' }), ctx)) as {
    walletId: string;
    playerId: string;
  };

  return { walletId: w.walletId, playerId: w.playerId };
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

  expect(loss.status).toBe('PROCESSED');
  expect((await queries.wallet(w.walletId)).version).toBe(2);

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
  ).toBe('REFERENCE_ALREADY_REVERSED');

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.consistent).toBe(true);
  expect(recon.checkedEntries).toBe(4);

  const first = await queries.ledger(w.walletId, undefined, 2);
  const second = await queries.ledger(w.walletId, first.nextCursor!, 2);

  expect(first.items.length + second.items.length).toBe(4);
  expect(second.nextCursor).toBeNull();
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

  expect(results.filter((r) => r.status === 'PROCESSED')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'REJECTED')).toHaveLength(1);

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

  const crashing = new WageringService(new MikroFinancialUnitOfWork(db), undefined, {
    beforeCommit: () => {
      throw new Error('simulated crash');
    },
  });

  await expect(
    crashing.process(bet, { ...ctx, consumerName: 'test', messageId: newId() }),
  ).rejects.toThrow('simulated crash');
  expect(await queries.byKey(bet.idempotencyKey)).toBeNull();
  expect((await queries.reconciliation(w.walletId)).checkedEntries).toBe(1);
  expect((await service.process(bet, ctx)).status).toBe('PROCESSED');
});

test('pending reference survives reconnect, resolves after parent and expires using injected clock', async () => {
  const w = await wallet();
  const bet = command(w);
  const refund = command(w, 'REFUND', '25.00', bet.externalTransactionId);
  const pending = await service.process(refund, ctx);

  expect(pending.status).toBe('PENDING_REFERENCE');

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

  expect((await queries.transaction(pending.transactionId)).status).toBe('PROCESSED');

  const absent = command(w, 'REFUND', '25.00', newId());
  const waiting = await service.process(absent, ctx);

  await new WageringService(new MikroFinancialUnitOfWork(db), {
    now: () => new Date(Date.now() + 1_000_000),
  }).retryReference(waiting.transactionId, absent.idempotencyKey, ctx);

  expect((await queries.transaction(waiting.transactionId)).failureCode).toBe(
    'REFERENCE_NOT_FOUND',
  );
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
  ).toBe('REFERENCE_CONTEXT_MISMATCH');
  expect(
    (await service.process(command(first, 'REFUND', '24.00', bet.externalTransactionId), ctx))
      .failureCode,
  ).toBe('REFERENCE_AMOUNT_MISMATCH');

  const empty = await wallet('0.00');
  const win = command(empty, 'WIN', '40.00');

  await service.process(win, ctx);
  await service.process(command(empty, 'BET', '40.00'), ctx);

  const rollback = command(empty, 'ROLLBACK', '40.00', win.externalTransactionId);
  const denied = await service.process(rollback, ctx);

  expect(denied.failureCode).toBe('REVERSAL_INSUFFICIENT_FUNDS');
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

  expect(results.map((r) => r.status).sort()).toEqual(['PROCESSED', 'REJECTED']);

  const recon = await queries.reconciliation(w.walletId);

  expect(recon.consistent).toBe(true);
  expect(recon.storedBalance.amount).toBe('100.00');
  expect(recon.checkedEntries).toBe(3);
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
