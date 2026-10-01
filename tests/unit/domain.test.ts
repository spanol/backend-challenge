import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money';
import { Wallet, WalletLedgerEntry } from '../../src/domain/wallet';
import { WagerTransaction } from '../../src/domain/wager';
import { WagerTransactionProcessed } from '../../src/domain/events';
import { parseCommand, payloadHash, newId, object } from '../../src/application/contracts';

const money = (amount: string, currency = 'BRL') => Money.from({ amount, currency });

const now = new Date('2026-09-30T12:00:00Z');

const transaction = (kind: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK' = 'BET') =>
  WagerTransaction.create({
    id: newId(),
    walletId: 'wallet',
    playerId: 'player',
    providerId: 'provider',
    externalTransactionId: 'ext',
    idempotencyKey: 'key',
    payloadHash: 'hash',
    roundId: 'round',
    gameId: 'game',
    kind,
    money: money('25.00'),
    referenceExternalTransactionId: kind === 'REFUND' || kind === 'ROLLBACK' ? 'bet' : undefined,
    createdAt: now,
  });

describe('exact and immutable Money', () => {
  test.each(['', 'NaN', 'Infinity', '1e2', '-1.00', '1.001', ' 1.00', '1,00', '1', '1.0'])(
    'rejects invalid amount %s',
    (amount) => expect(() => money(amount)).toThrow(),
  );
  test('rejects numbers, unknown currencies and precision overflow', () => {
    expect(() => Money.from({ amount: 1 as unknown as string, currency: 'BRL' })).toThrow();
    expect(() => money('1.00', 'XYZ')).toThrow();
    expect(() => money('1000000000000000000.00')).toThrow();
  });
  test('exact arithmetic above Number.MAX_SAFE_INTEGER and negative internal differences', () => {
    expect(money('0.10').add(money('0.20')).toString()).toBe('0.30');

    const original = money('900719925474099.01');

    expect(original.add(money('0.09')).toString()).toBe('900719925474099.10');
    expect(original.toString()).toBe('900719925474099.01');
    expect(money('0.10').subtract(money('0.20')).toString()).toBe('-0.10');
    expect(Object.isFrozen(original)).toBe(true);
    expect(() => original.add(money('1.00', 'USD'))).toThrow('CURRENCY_MISMATCH');
  });
});

describe('financial domain', () => {
  test('changes balance only with a balanced immutable ledger and increments version', () => {
    const wallet = Wallet.open({
      id: 'wallet',
      playerId: 'player',
      initialBalance: money('100.00'),
      at: now,
    });

    const entry = wallet.debit(money('80.00'), 'bet', 'ledger', now);

    expect(wallet.balance.toString()).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(entry.isBalanced()).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => wallet.debit(money('80.00'), 'other', 'other', now)).toThrow('INSUFFICIENT_FUNDS');
    expect(wallet.version).toBe(2);
    expect(() =>
      WalletLedgerEntry.create({
        id: 'bad',
        walletId: 'wallet',
        transactionId: 'bet',
        direction: 'CREDIT',
        money: money('1.00'),
        balanceBefore: money('20.00'),
        balanceAfter: money('22.00'),
        walletVersion: 3,
        createdAt: now,
      }),
    ).toThrow();
  });
  test('terminal states cannot transition and LOSS does not affect balance', () => {
    const t = transaction();

    t.markPendingReference();
    t.markProcessed(undefined, now);

    expect(() => t.reject('error')).toThrow('INVALID_TRANSACTION_STATE');
    expect(transaction('LOSS').affectsBalance()).toBe(false);

    const rejected = transaction();

    rejected.reject('INSUFFICIENT_FUNDS');

    expect(() => rejected.markProcessed(undefined, now)).toThrow();

    const failed = transaction();

    failed.fail('INFRA');

    expect(() => failed.markPendingReference()).toThrow();
  });
  test('reference validation checks full amount, context, kind and terminal status', () => {
    const bet = transaction();

    bet.markProcessed(undefined, now);

    expect(transaction('REFUND').validateReference(bet)).toBeUndefined();

    const other = transaction('WIN');

    other.markProcessed(undefined, now);

    expect(transaction('REFUND').validateReference(other)).toBe('REFERENCE_KIND_INVALID');
    expect(transaction('ROLLBACK').ledgerDirectionFor(other)).toBe('DEBIT');
    expect(transaction('ROLLBACK').ledgerDirectionFor(bet)).toBe('CREDIT');

    const denied = transaction();

    denied.reject('INSUFFICIENT_FUNDS');

    expect(transaction('REFUND').validateReference(denied)).toBe('REFERENCE_NOT_PROCESSED');
  });
  test('rehydration restores state without replaying transitions', () => {
    const restored = WagerTransaction.rehydrate({
      id: 'old',
      walletId: 'w',
      playerId: 'p',
      providerId: 'provider',
      externalTransactionId: 'e',
      idempotencyKey: 'k',
      payloadHash: 'h',
      roundId: 'r',
      gameId: 'g',
      kind: 'REFUND',
      money: money('0.00'),
      status: 'REJECTED',
      failureCode: 'LEGACY',
      createdAt: now,
    });

    expect(restored.status).toBe('REJECTED');
  });
});

test('canonical business hash excludes idempotency key and is stable across object ordering', () => {
  const command = parseCommand(
    {
      providerId: 'provider',
      externalTransactionId: 'ext',
      playerId: newId(),
      walletId: newId(),
      roundId: 'round',
      gameId: 'game',
      kind: 'BET',
      money: { currency: 'BRL', amount: '1.00' },
    },
    'key',
  );

  expect(payloadHash(command)).toBe(payloadHash({ ...command, idempotencyKey: 'other' }));
  expect(payloadHash(command)).not.toBe(
    payloadHash({ ...command, money: { amount: '2.00', currency: 'BRL' } }),
  );
});

test('events freeze nested JSON and serialize money as plain strings', () => {
  const event = WagerTransactionProcessed.from(
    { eventId: 'event', aggregateId: 'wallet', correlationId: 'corr', occurredAt: now },
    {
      transactionId: 'txn',
      providerId: 'provider',
      status: 'PROCESSED',
      balance: money('20.00').toJSON(),
    },
  );

  expect(Object.isFrozen(event.data.balance)).toBe(true);
  expect(Object.isFrozen(event)).toBe(true);
  expect(event.correlationId).toBe('corr');

  const serialized = object(JSON.parse(JSON.stringify(event)) as unknown);

  expect(object(serialized.data).balance).toEqual({
    amount: '20.00',
    currency: 'BRL',
  });
});
