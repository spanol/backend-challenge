import type { Money } from '../money';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface WalletOpeningProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  at: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  walletVersion: number;
  createdAt: Date;
}
