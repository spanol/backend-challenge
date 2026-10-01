import type { Money } from '../money';
import type { MoneyProps } from './money';
import { WagerKind, WagerStatus, wagerKinds } from '../constants/wager';

export { WagerKind, WagerStatus, wagerKinds };

export type WagerCommandKind = Exclude<WagerKind, WagerKind.OPENING>;

export interface WagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerCommandKind;
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
