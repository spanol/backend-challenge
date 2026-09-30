import type { MoneyProps } from './money';
import type { WagerStatus } from './wager';
import type { LedgerDirection } from './wallet';

export interface EventContext {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}

export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  version: number;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  data: Readonly<T>;
}

export interface TransactionEventData {
  transactionId: string;
  providerId: string;
  status: WagerStatus;
  failureCode?: string;
  balance: MoneyProps;
}

export interface BalanceEventData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}
