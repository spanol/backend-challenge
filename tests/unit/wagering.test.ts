import { expect, test } from 'bun:test';
import { WageringService } from '../../src/application/wagering';
import { newId } from '../../src/application/contracts';
import type {
  FinancialSession,
  FinancialUnitOfWork,
  TransactionRecord,
} from '../../src/application/types/financial';
import { Money } from '../../src/domain/money';
import { Wallet, type WalletLedgerEntry } from '../../src/domain/wallet';
import type { IntegrationEvent } from '../../src/domain/events';
import type { WagerCommand, WagerKind } from '../../src/domain/types/wager';

const at = new Date('2026-09-30T12:00:00Z');
const ctx = { correlationId: 'unit-wagering' };

// Sequential port double for application/domain rules. SQL atomicity and concurrency use real suites.
function fixture(initialBalance = '100.00') {
  const wallet = Wallet.open({
    id: newId(),
    playerId: newId(),
    initialBalance: Money.from({ amount: initialBalance, currency: 'BRL' }),
    at,
  });
  const records: TransactionRecord[] = [];
  const ledger: WalletLedgerEntry[] = [];
  const events: IntegrationEvent<unknown>[] = [];
  let walletWrites = 0;

  const session: FinancialSession = {
    wallet: (id) => Promise.resolve(id === wallet.id ? wallet : undefined),
    saveWallet: () => {
      walletWrites++;
      return Promise.resolve();
    },
    byKey: (key) => Promise.resolve(records.find((r) => r.transaction.idempotencyKey === key)),
    byId: (id) => Promise.resolve(records.find((r) => r.transaction.id === id)),
    byExternal: (provider, external) =>
      Promise.resolve(
        records.find(
          (r) =>
            r.transaction.providerId === provider &&
            r.transaction.externalTransactionId === external,
        ),
      ),
    reversalOf: (id) =>
      Promise.resolve(
        records.some(
          (r) =>
            r.transaction.referenceTransactionId === id &&
            r.transaction.requiresReference() &&
            r.transaction.status === 'PROCESSED',
        ),
      ),
    saveTransaction: (transaction, result, retry) => {
      const record = { transaction, result, attempts: retry?.attempts ?? 0 };
      const index = records.findIndex((r) => r.transaction.id === transaction.id);

      if (index === -1) records.push(record);
      else records[index] = record;

      return Promise.resolve();
    },
    addLedger: (entry) => {
      ledger.push(entry);
    },
    addEvent: (event) => {
      events.push(event);
    },
    inbox: () => Promise.resolve(undefined),
    saveInbox: () => undefined,
  };

  const uow: FinancialUnitOfWork = { run: (_locks, work) => work(session) };
  const service = new WageringService(uow, { now: () => at });

  function command(
    kind: Exclude<WagerKind, 'OPENING'> = 'BET',
    amount = '25.00',
    referenceExternalTransactionId?: string,
  ): WagerCommand {
    return {
      walletId: wallet.id,
      playerId: wallet.playerId,
      providerId: 'unit-provider',
      externalTransactionId: newId(),
      idempotencyKey: newId(),
      roundId: 'round',
      gameId: 'game',
      kind,
      money: { amount, currency: 'BRL' },
      referenceExternalTransactionId,
    };
  }

  return { wallet, records, ledger, events, service, command, walletWrites: () => walletWrites };
}

test.each([
  { kind: 'BET', parent: undefined, balance: '75.00', direction: 'DEBIT' },
  { kind: 'WIN', parent: undefined, balance: '125.00', direction: 'CREDIT' },
  { kind: 'LOSS', parent: undefined, balance: '100.00', direction: undefined },
  { kind: 'REFUND', parent: 'BET', balance: '100.00', direction: 'CREDIT' },
  { kind: 'ROLLBACK', parent: 'BET', balance: '100.00', direction: 'CREDIT' },
  { kind: 'ROLLBACK', parent: 'WIN', balance: '100.00', direction: 'DEBIT' },
  { kind: 'ROLLBACK', parent: 'REFUND', balance: '75.00', direction: 'DEBIT' },
] as const)(
  '$kind with reference $parent produces coherent result, ledger, version and events',
  async ({ kind, parent, balance, direction }) => {
    const f = fixture();
    let reference: WagerCommand | undefined;

    if (parent === 'REFUND') {
      const bet = f.command();

      await f.service.process(bet, ctx);
      reference = f.command('REFUND', '25.00', bet.externalTransactionId);
    } else if (parent) reference = f.command(parent);

    let referenceId: string | undefined;

    if (reference) referenceId = (await f.service.process(reference, ctx)).transactionId;

    const before = f.wallet.balance;
    const version = f.wallet.version;
    const ledgerCount = f.ledger.length;
    const eventCount = f.events.length;
    const writes = f.walletWrites();
    const command = f.command(
      kind,
      kind === 'LOSS' ? '0.00' : '25.00',
      reference?.externalTransactionId,
    );
    const result = await f.service.process(command, ctx);

    expect(result).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: balance, currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(f.records.at(-1)!.transaction.referenceTransactionId).toBe(referenceId);
    expect(f.wallet.balance.toString()).toBe(balance);
    expect(f.wallet.version).toBe(version + (direction ? 1 : 0));
    expect(f.walletWrites()).toBe(writes + (direction ? 1 : 0));
    expect(f.ledger).toHaveLength(ledgerCount + (direction ? 1 : 0));

    if (direction) {
      const entry = f.ledger.at(-1)!;

      expect(entry.transactionId).toBe(result.transactionId);
      expect(entry.direction).toBe(direction);
      expect(entry.money.toString()).toBe('25.00');
      expect(entry.balanceBefore.equals(before)).toBe(true);
      expect(entry.balanceAfter.toString()).toBe(balance);
      expect(entry.walletVersion).toBe(version + 1);
      expect(entry.isBalanced()).toBe(true);
    }

    const events = f.events.slice(eventCount);

    expect(events.map((e) => e.eventType).sort()).toEqual(
      direction
        ? ['WagerTransactionProcessed', 'WalletBalanceChanged']
        : ['WagerTransactionProcessed'],
    );
    for (const event of events) {
      expect(event.version).toBe(1);
      expect(event.data).toMatchObject({ transactionId: result.transactionId });
    }

    expect(await f.service.process(command, ctx)).toEqual({ ...result, idempotentReplay: true });
    expect(f.events).toHaveLength(eventCount + events.length);
    expect(f.ledger).toHaveLength(ledgerCount + (direction ? 1 : 0));
  },
);

test('same key with divergent payload conflicts without changing the original result or effects', async () => {
  const f = fixture();
  const command = f.command();
  const original = await f.service.process(command, ctx);
  const hash = f.records[0]!.transaction.payloadHash;

  // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun 1.4.2 types rejects matchers as void; runtime must await them.
  await expect(
    f.service.process({ ...command, money: { amount: '26.00', currency: 'BRL' } }, ctx),
  ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
  expect(f.wallet.balance.toString()).toBe('75.00');
  expect(f.wallet.version).toBe(2);
  expect(f.records).toHaveLength(1);
  expect(f.records[0]!.transaction.payloadHash).toBe(hash);
  expect(f.records[0]!.result).toEqual({
    transactionId: original.transactionId,
    status: original.status,
    balance: original.balance,
    snapshotVersion: 2,
  });
  expect(f.ledger).toHaveLength(1);
  expect(f.events).toHaveLength(2);
  expect(await f.service.process(command, ctx)).toEqual({ ...original, idempotentReplay: true });
});

test.each(['BET', 'ROLLBACK'] as const)(
  '%s without funds rejects without financial effects and preserves historical replay',
  async (kind) => {
    const f = fixture('0.00');
    let reference: WagerCommand | undefined;

    if (kind === 'ROLLBACK') {
      reference = f.command('WIN');
      await f.service.process(reference, ctx);
      await f.service.process(f.command('BET'), ctx);
    }

    const ledgerCount = f.ledger.length;
    const eventCount = f.events.length;
    const version = f.wallet.version;
    const command = f.command(kind, '25.00', reference?.externalTransactionId);
    const rejected = await f.service.process(command, ctx);

    expect(rejected).toMatchObject({
      status: 'REJECTED',
      failureCode: kind === 'BET' ? 'INSUFFICIENT_FUNDS' : 'REVERSAL_INSUFFICIENT_FUNDS',
      balance: { amount: '0.00', currency: 'BRL' },
    });
    expect(f.wallet.version).toBe(version);
    expect(f.ledger).toHaveLength(ledgerCount);
    expect(f.events.slice(eventCount).map((e) => e.eventType)).toEqual([
      'WagerTransactionRejected',
    ]);

    await f.service.process(f.command('WIN', '50.00'), ctx);

    expect(await f.service.process(command, ctx)).toEqual({ ...rejected, idempotentReplay: true });
    expect(f.wallet.balance.toString()).toBe('50.00');
  },
);
