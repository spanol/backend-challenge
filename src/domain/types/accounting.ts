import type { AccountingAccountType } from '../constants/accounting';
import type { LedgerDirection } from '../constants/wallet';
import type { Money } from '../money';

export interface AccountingPostingState {
  accountType: AccountingAccountType;
  accountId?: string;
  direction: LedgerDirection;
  money: Money;
}

export interface AccountingJournalState {
  transactionId: string;
  walletId: string;
  createdAt: Date;
  postings: readonly AccountingPostingState[];
}
