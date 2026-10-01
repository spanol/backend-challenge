import { LockMode } from '@mikro-orm/core';
import { Money } from '../../domain/money';
import { Wallet, type WalletLedgerEntry } from '../../domain/wallet';
import { WagerTransaction } from '../../domain/wager';
import type { IntegrationEvent } from '../../domain/events';
import { InboxMessage, OutboxMessage } from '../../domain/messages';
import type {
  Delivery,
  FinancialSession,
  FinancialUnitOfWork,
  StoredResult,
  TransactionRecord,
  RetrySchedule,
} from '../../application/types/financial';
import type { Database, SqlManager } from './types/database';
import { WalletRow, TransactionRow, LedgerRow, InboxRow, OutboxRow } from './entities';

function record(row: TransactionRow): TransactionRecord {
  return {
    transaction: WagerTransaction.rehydrate({
      ...row,
      money: Money.from({ amount: row.amount, currency: row.currency }),
    }),
    result: row.result ?? undefined,
    attempts: row.referenceAttempts,
    leaseToken: row.leaseToken,
  };
}

class MikroFinancialSession implements FinancialSession {
  constructor(private readonly em: SqlManager) {}

  async wallet(id: string, lock = false): Promise<Wallet | undefined> {
    const row = await this.em.findOne(
      WalletRow,
      { id },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : {},
    );

    return row
      ? Wallet.rehydrate({
          ...row,
          balance: Money.from({ amount: row.balance, currency: row.currency }),
        })
      : undefined;
  }

  async saveWallet(wallet: Wallet): Promise<void> {
    const row = (await this.em.findOne(WalletRow, { id: wallet.id })) ?? new WalletRow();

    Object.assign(row, {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.toString(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    });
    this.em.persist(row);
  }

  async byKey(key: string): Promise<TransactionRecord | undefined> {
    const row = await this.em.findOne(TransactionRow, { idempotencyKey: key });

    return row ? record(row) : undefined;
  }

  async byId(id: string): Promise<TransactionRecord | undefined> {
    const row = await this.em.findOne(TransactionRow, { id });

    return row ? record(row) : undefined;
  }

  async byExternal(
    providerId: string,
    externalTransactionId: string,
  ): Promise<TransactionRecord | undefined> {
    const row = await this.em.findOne(TransactionRow, { providerId, externalTransactionId });

    return row ? record(row) : undefined;
  }

  async reversalOf(referenceTransactionId: string): Promise<boolean> {
    return (
      (await this.em.count(TransactionRow, {
        referenceTransactionId,
        status: 'PROCESSED',
        kind: { $in: ['REFUND', 'ROLLBACK'] },
      })) > 0
    );
  }

  async saveTransaction(
    t: WagerTransaction,
    result?: StoredResult,
    retry?: RetrySchedule,
  ): Promise<void> {
    const row = (await this.em.findOne(TransactionRow, { id: t.id })) ?? new TransactionRow();

    Object.assign(row, {
      id: t.id,
      providerId: t.providerId,
      externalTransactionId: t.externalTransactionId,
      idempotencyKey: t.idempotencyKey,
      payloadHash: t.payloadHash,
      walletId: t.walletId,
      playerId: t.playerId,
      roundId: t.roundId,
      gameId: t.gameId,
      kind: t.kind,
      amount: t.money.toString(),
      currency: t.money.currency,
      status: t.status,
      referenceExternalTransactionId: t.referenceExternalTransactionId,
      referenceTransactionId: t.referenceTransactionId,
      failureCode: t.failureCode,
      createdAt: t.createdAt,
      processedAt: t.processedAt,
      result: t.isTerminal() ? result : undefined,
      nextAttemptAt: retry?.nextAt ?? row.nextAttemptAt ?? t.createdAt,
      referenceAttempts: retry?.attempts ?? row.referenceAttempts,
      leaseToken: undefined,
      leaseUntil: undefined,
    });
    this.em.persist(row);
  }

  addLedger(e: WalletLedgerEntry): void {
    this.em.persist(
      Object.assign(new LedgerRow(), {
        id: e.id,
        walletId: e.walletId,
        transactionId: e.transactionId,
        direction: e.direction,
        amount: e.money.toString(),
        currency: e.money.currency,
        balanceBefore: e.balanceBefore.toString(),
        balanceAfter: e.balanceAfter.toString(),
        walletVersion: e.walletVersion,
        createdAt: e.createdAt,
      }),
    );
  }

  addEvent(e: IntegrationEvent<unknown>): void {
    const outbox = OutboxMessage.enqueue(e);

    this.em.persist(
      Object.assign(new OutboxRow(), {
        id: outbox.id,
        aggregateId: outbox.aggregateId,
        eventType: outbox.eventType,
        payload: outbox.payload,
        occurredAt: outbox.occurredAt,
        nextAttemptAt: outbox.occurredAt,
      }),
    );
  }

  async inbox(d: Delivery): Promise<InboxRow | undefined> {
    return (
      (await this.em.findOne(InboxRow, { consumerName: d.consumerName, messageId: d.messageId })) ??
      undefined
    );
  }

  saveInbox(d: Delivery, transactionId: string, at: Date): void {
    const inbox = InboxMessage.receive({ ...d, receivedAt: at });

    inbox.markProcessed(at);
    this.em.persist(
      Object.assign(new InboxRow(), {
        consumerName: inbox.consumerName,
        messageId: inbox.messageId,
        payloadHash: inbox.payloadHash,
        transactionId,
        receivedAt: inbox.receivedAt,
        processedAt: inbox.processedAt,
      }),
    );
  }
}

export class MikroFinancialUnitOfWork implements FinancialUnitOfWork {
  constructor(
    private readonly db: Database,
    private readonly onTransientConflict: () => void = () => undefined,
  ) {}

  async run<T>(locks: string[], work: (session: FinancialSession) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.em.fork().transactional(async (em) => {
          await em.execute("SET LOCAL lock_timeout = '5s'");

          // Persistent SQL constraints remain authoritative; these transaction locks avoid duplicate races across wallets.
          for (const lock of locks)
            await em.execute('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [lock]);

          return work(new MikroFinancialSession(em));
        });
      } catch (error) {
        if (!['40P01', '40001', '55P03'].includes((error as { code?: string }).code ?? ''))
          throw error;

        this.onTransientConflict();

        if (attempt >= 2) throw error;

        await Bun.sleep(20 * 2 ** attempt);
      }
    }
  }
}
