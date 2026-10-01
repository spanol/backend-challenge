import { describe, expect, test } from 'bun:test';
import { AccountingJournalEntry } from '../../src/domain/accounting';
import { AccountingAccountType } from '../../src/domain/constants/accounting';
import { LedgerDirection } from '../../src/domain/constants/wallet';
import { Money } from '../../src/domain/money';
import { Wallet } from '../../src/domain/wallet';

const money = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('double-entry accounting mapper', () => {
  test.each([
    {
      direction: LedgerDirection.DEBIT,
      walletSide: LedgerDirection.DEBIT,
      clearingSide: LedgerDirection.CREDIT,
    },
    {
      direction: LedgerDirection.CREDIT,
      walletSide: LedgerDirection.CREDIT,
      clearingSide: LedgerDirection.DEBIT,
    },
  ])(
    'maps a wallet $direction to balanced liability and clearing postings',
    ({ direction, walletSide, clearingSide }) => {
      const wallet = Wallet.open({
        id: 'wallet-id',
        playerId: 'player-id',
        initialBalance: money('100.00'),
        at: new Date('2026-10-01T12:00:00.000Z'),
      });
      const ledger = wallet[direction === LedgerDirection.DEBIT ? 'debit' : 'credit'](
        money('10.00'),
        'transaction-id',
        'ledger-id',
        new Date('2026-10-01T12:01:00.000Z'),
      );
      const journal = AccountingJournalEntry.fromWalletLedger(ledger);

      expect(journal.isBalanced()).toBe(true);
      expect(journal.transactionId).toBe('transaction-id');
      expect(journal.walletId).toBe('wallet-id');
      expect(journal.postings).toEqual([
        {
          accountType: AccountingAccountType.WALLET_LIABILITY,
          accountId: 'wallet-id',
          direction: walletSide,
          money: money('10.00'),
        },
        {
          accountType: AccountingAccountType.PLATFORM_CLEARING,
          direction: clearingSide,
          money: money('10.00'),
        },
      ]);
      expect(Object.isFrozen(journal)).toBe(true);
      expect(Object.isFrozen(journal.postings)).toBe(true);
      expect(Object.isFrozen(journal.postings[0])).toBe(true);
    },
  );
});
