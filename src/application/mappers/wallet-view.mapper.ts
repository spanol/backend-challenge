import type { Money } from '../../domain/money';
import type { WalletView } from '../types/wallet';

export type WalletViewInput = Omit<WalletView, 'balance'> & { balance: Money };

export function toWalletView(wallet: WalletViewInput): WalletView {
  return {
    walletId: wallet.walletId,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}
