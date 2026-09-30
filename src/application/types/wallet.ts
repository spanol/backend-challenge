import type { MoneyProps } from '../../domain/types/money';

export interface WalletView {
  walletId: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
}
