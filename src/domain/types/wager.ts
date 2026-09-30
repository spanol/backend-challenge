import type { Money } from '../money';
import type { MoneyProps } from './money';
import type { wagerKinds } from '../constants/wager';

export type WagerKind = (typeof wagerKinds)[number] | 'OPENING';

export type WagerStatus = 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';

export interface WagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: Exclude<WagerKind, 'OPENING'>;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface WagerState extends Omit<WagerCommand, 'kind' | 'money'> {
  id: string;
  kind: WagerKind;
  money: Money;
  payloadHash: string;
  createdAt: Date;
  status: WagerStatus;
  referenceTransactionId?: string;
  failureCode?: string;
  processedAt?: Date;
}
