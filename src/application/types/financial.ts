import type { Wallet, WalletLedgerEntry } from '../../domain/wallet';
import type { WagerTransaction } from '../../domain/wager';
import type { IntegrationEvent } from '../../domain/events';
import type { ProcessingResult } from './wagering';

export type StoredResult = Omit<ProcessingResult, 'idempotentReplay'> & {
  snapshotVersion?: number;
};

export interface TransactionRecord {
  transaction: WagerTransaction;
  result?: StoredResult;
  attempts: number;
  leaseToken?: string;
}

export interface Delivery {
  consumerName: string;
  messageId: string;
  payloadHash: string;
}

export interface RetrySchedule {
  attempts: number;
  nextAt: Date;
}

export interface InboxRecord {
  payloadHash: string;
  transactionId: string;
}

export interface FinancialSession {
  wallet(id: string, lock?: boolean): Promise<Wallet | undefined>;

  saveWallet(wallet: Wallet): Promise<void>;

  byKey(key: string): Promise<TransactionRecord | undefined>;

  byId(id: string): Promise<TransactionRecord | undefined>;

  byExternal(provider: string, externalId: string): Promise<TransactionRecord | undefined>;

  reversalOf(id: string): Promise<boolean>;

  saveTransaction(
    transaction: WagerTransaction,
    result?: StoredResult,
    retry?: RetrySchedule,
  ): Promise<void>;

  addLedger(entry: WalletLedgerEntry): void;

  addEvent(event: IntegrationEvent<unknown>): void;

  inbox(delivery: Delivery): Promise<InboxRecord | undefined>;

  saveInbox(delivery: Delivery, transactionId: string, at: Date): void;
}

export interface FinancialUnitOfWork {
  run<T>(locks: string[], work: (session: FinancialSession) => Promise<T>): Promise<T>;
}
