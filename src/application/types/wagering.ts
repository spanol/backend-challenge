import type { MoneyProps } from '../../domain/types/money';
import type { WagerStatus } from '../../domain/types/wager';

export interface ProcessingContext {
  correlationId: string;
  messageId?: string;
  consumerName?: string;
}

export interface ProcessingResult {
  transactionId: string;
  status: WagerStatus;
  balance: MoneyProps;
  failureCode?: string;
  idempotentReplay: boolean;
}

export interface ReferenceRetryPolicy {
  ttlMs: number;
  maxAttempts: number;
}
