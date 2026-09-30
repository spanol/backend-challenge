import { DomainError, type Money } from './money';
import type { LedgerDirection, WalletState, LedgerState, WalletOpeningProps } from './types/wallet';

export class WalletLedgerEntry {
  private constructor(private readonly state: Readonly<LedgerState>) {
    Object.freeze(state);
    Object.freeze(this);
  }

  static create(state: LedgerState): WalletLedgerEntry {
    const entry = new WalletLedgerEntry({ ...state, createdAt: new Date(state.createdAt) });

    if (
      !state.money.isPositive() ||
      state.balanceBefore.isNegative() ||
      state.balanceAfter.isNegative() ||
      !entry.isBalanced()
    )
      throw new DomainError('UNBALANCED_LEDGER');

    return entry;
  }

  static rehydrate(state: LedgerState): WalletLedgerEntry {
    return new WalletLedgerEntry({ ...state, createdAt: new Date(state.createdAt) });
  }

  get id(): string {
    return this.state.id;
  }

  get walletId(): string {
    return this.state.walletId;
  }

  get transactionId(): string {
    return this.state.transactionId;
  }

  get direction(): LedgerDirection {
    return this.state.direction;
  }

  get money(): Money {
    return this.state.money;
  }

  get balanceBefore(): Money {
    return this.state.balanceBefore;
  }

  get balanceAfter(): Money {
    return this.state.balanceAfter;
  }

  get walletVersion(): number {
    return this.state.walletVersion;
  }

  get createdAt(): Date {
    return new Date(this.state.createdAt);
  }

  isBalanced(): boolean {
    const expected =
      this.direction === 'CREDIT'
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);

    return expected.equals(this.balanceAfter);
  }
}

export class Wallet {
  private constructor(private state: WalletState) {
    this.state = {
      ...state,
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
    };
  }

  static open(props: WalletOpeningProps): Wallet {
    if (props.initialBalance.isNegative()) throw new DomainError('INVALID_AMOUNT');

    return new Wallet({
      id: props.id,
      playerId: props.playerId,
      balance: props.initialBalance,
      version: 1,
      createdAt: props.at,
      updatedAt: props.at,
    });
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet({ ...state });
  }

  get id(): string {
    return this.state.id;
  }

  get playerId(): string {
    return this.state.playerId;
  }

  get currency(): string {
    return this.balance.currency;
  }

  get balance(): Money {
    return this.state.balance;
  }

  get version(): number {
    return this.state.version;
  }

  get createdAt(): Date {
    return new Date(this.state.createdAt);
  }

  get updatedAt(): Date {
    return new Date(this.state.updatedAt);
  }

  debit(money: Money, transactionId: string, entryId: string, at: Date): WalletLedgerEntry {
    return this.move('DEBIT', money, transactionId, entryId, at);
  }

  credit(money: Money, transactionId: string, entryId: string, at: Date): WalletLedgerEntry {
    return this.move('CREDIT', money, transactionId, entryId, at);
  }

  private move(
    direction: LedgerDirection,
    money: Money,
    transactionId: string,
    id: string,
    at: Date,
  ): WalletLedgerEntry {
    if (!money.isPositive()) throw new DomainError('INVALID_AMOUNT');

    const before = this.balance;
    const after = direction === 'CREDIT' ? before.add(money) : before.subtract(money);

    if (after.isNegative()) throw new DomainError('INSUFFICIENT_FUNDS');

    const entry = WalletLedgerEntry.create({
      id,
      walletId: this.id,
      transactionId,
      direction,
      money,
      balanceBefore: before,
      balanceAfter: after,
      walletVersion: this.version + 1,
      createdAt: at,
    });

    this.state = {
      ...this.state,
      balance: after,
      version: this.version + 1,
      updatedAt: new Date(at),
    };

    return entry;
  }
}
