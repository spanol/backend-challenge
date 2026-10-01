import { EntitySchema } from '@mikro-orm/core';
import { DecimalStringType } from './decimal-string';
import type { StoredResult } from '../../application/types/financial';
import type { LedgerDirection } from '../../domain/types/wallet';
import type { WagerKind, WagerStatus } from '../../domain/types/wager';
import type { IntegrationEventType } from '../../domain/constants/events';
import type { AccountingAccountType } from '../../domain/constants/accounting';
import type { EventEnvelope } from '../../domain/types/events';

export class WalletRow {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class TransactionRow {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: WagerKind;
  amount!: string;
  currency!: string;
  status!: WagerStatus;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  failureCode?: string;
  result?: StoredResult;
  createdAt!: Date;
  processedAt?: Date;
  referenceAttempts = 0;
  nextAttemptAt!: Date;
  leaseToken?: string;
  leaseUntil?: Date;
}

export class LedgerRow {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: LedgerDirection;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  walletVersion!: number;
  createdAt!: Date;
}

export class AccountingJournalRow {
  transactionId!: string;
  walletId!: string;
  currency!: string;
  createdAt!: Date;
}

export class AccountingJournalLineRow {
  journalId!: string;
  lineNumber!: number;
  accountType!: AccountingAccountType;
  accountId?: string;
  direction!: LedgerDirection;
  amount!: string;
  currency!: string;
}

export class InboxRow {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  transactionId!: string;
  receivedAt!: Date;
  processedAt!: Date;
}

export class OutboxRow {
  id!: string;
  aggregateId!: string;
  eventType!: IntegrationEventType;
  payload!: EventEnvelope;
  occurredAt!: Date;
  publishedAt?: Date;
  attempts = 0;
  nextAttemptAt!: Date;
  leaseToken?: string;
  leaseUntil?: Date;
}

const id = { type: 'uuid', primary: true } as const;
const uuid = { type: 'uuid' } as const;
const text = { type: 'text' } as const;
const date = { type: Date, columnType: 'timestamptz' } as const;

const decimal = () => ({ type: new DecimalStringType(), precision: 20, scale: 2 });

export const entities = [
  new EntitySchema<WalletRow>({
    class: WalletRow,
    tableName: 'wallets',
    properties: {
      id,
      playerId: text,
      currency: text,
      balance: decimal(),
      version: { type: 'integer' },
      createdAt: date,
      updatedAt: date,
    },
  }),
  new EntitySchema<TransactionRow>({
    class: TransactionRow,
    tableName: 'wager_transactions',
    properties: {
      id,
      providerId: text,
      externalTransactionId: text,
      idempotencyKey: text,
      payloadHash: text,
      walletId: uuid,
      playerId: text,
      roundId: text,
      gameId: text,
      kind: text,
      amount: decimal(),
      currency: text,
      status: text,
      referenceExternalTransactionId: { ...text, nullable: true },
      referenceTransactionId: { ...uuid, nullable: true },
      failureCode: { ...text, nullable: true },
      result: { type: 'json', nullable: true },
      createdAt: date,
      processedAt: { ...date, nullable: true },
      referenceAttempts: { type: 'integer' },
      nextAttemptAt: date,
      leaseToken: { ...uuid, nullable: true },
      leaseUntil: { ...date, nullable: true },
    },
  }),
  new EntitySchema<LedgerRow>({
    class: LedgerRow,
    tableName: 'wallet_ledger',
    properties: {
      id,
      walletId: uuid,
      transactionId: uuid,
      direction: text,
      amount: decimal(),
      currency: text,
      balanceBefore: decimal(),
      balanceAfter: decimal(),
      walletVersion: { type: 'integer' },
      createdAt: date,
    },
  }),
  new EntitySchema<AccountingJournalRow>({
    class: AccountingJournalRow,
    tableName: 'accounting_journals',
    properties: {
      transactionId: { ...uuid, primary: true },
      walletId: uuid,
      currency: text,
      createdAt: date,
    },
  }),
  new EntitySchema<AccountingJournalLineRow>({
    class: AccountingJournalLineRow,
    tableName: 'accounting_journal_lines',
    properties: {
      journalId: { ...uuid, primary: true },
      lineNumber: { type: 'smallint', primary: true },
      accountType: text,
      accountId: { ...uuid, nullable: true },
      direction: text,
      amount: decimal(),
      currency: text,
    },
  }),
  new EntitySchema<InboxRow>({
    class: InboxRow,
    tableName: 'inbox',
    properties: {
      consumerName: { ...text, primary: true },
      messageId: { ...text, primary: true },
      payloadHash: text,
      transactionId: uuid,
      receivedAt: date,
      processedAt: date,
    },
  }),
  new EntitySchema<OutboxRow>({
    class: OutboxRow,
    tableName: 'outbox',
    properties: {
      id,
      aggregateId: uuid,
      eventType: text,
      payload: { type: 'json' },
      occurredAt: date,
      publishedAt: { ...date, nullable: true },
      attempts: { type: 'integer' },
      nextAttemptAt: date,
      leaseToken: { ...uuid, nullable: true },
      leaseUntil: { ...date, nullable: true },
    },
  }),
];
