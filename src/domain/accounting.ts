import { AccountingAccountType } from './constants/accounting';
import { FinancialErrorCode } from './constants/errors';
import { LedgerDirection } from './constants/wallet';
import type { AccountingJournalState, AccountingPostingState } from './types/accounting';
import type { WalletLedgerEntry } from './wallet';
import { DomainError } from './money';

export class AccountingJournalEntry {
  private constructor(private readonly state: Readonly<AccountingJournalState>) {
    this.state = {
      ...state,
      createdAt: new Date(state.createdAt),
      postings: Object.freeze(state.postings.map((posting) => Object.freeze({ ...posting }))),
    };
    Object.freeze(this);
  }

  static fromWalletLedger(entry: WalletLedgerEntry): AccountingJournalEntry {
    const walletDirection = entry.direction;
    const clearingDirection =
      walletDirection === LedgerDirection.CREDIT ? LedgerDirection.DEBIT : LedgerDirection.CREDIT;
    const postings: readonly AccountingPostingState[] = [
      {
        accountType: AccountingAccountType.WALLET_LIABILITY,
        accountId: entry.walletId,
        direction: walletDirection,
        money: entry.money,
      },
      {
        accountType: AccountingAccountType.PLATFORM_CLEARING,
        direction: clearingDirection,
        money: entry.money,
      },
    ];
    const journal = new AccountingJournalEntry({
      transactionId: entry.transactionId,
      walletId: entry.walletId,
      createdAt: entry.createdAt,
      postings,
    });

    if (!journal.isBalanced())
      throw new DomainError(FinancialErrorCode.UNBALANCED_ACCOUNTING_JOURNAL);

    return journal;
  }

  get transactionId(): string {
    return this.state.transactionId;
  }

  get walletId(): string {
    return this.state.walletId;
  }

  get createdAt(): Date {
    return new Date(this.state.createdAt);
  }

  get postings(): readonly AccountingPostingState[] {
    return this.state.postings;
  }

  isBalanced(): boolean {
    if (this.postings.length !== 2) return false;

    const wallet = this.postings.find(
      (posting) => posting.accountType === AccountingAccountType.WALLET_LIABILITY,
    );
    const clearing = this.postings.find(
      (posting) => posting.accountType === AccountingAccountType.PLATFORM_CLEARING,
    );

    if (!wallet || !clearing) return false;

    return (
      wallet.accountId === this.walletId &&
      clearing.accountId === undefined &&
      wallet.money.equals(clearing.money) &&
      wallet.money.currency === clearing.money.currency &&
      wallet.direction !== clearing.direction &&
      (wallet.direction === LedgerDirection.CREDIT || wallet.direction === LedgerDirection.DEBIT)
    );
  }
}
