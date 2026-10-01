import type { MoneyProps } from './types/money';
import { FinancialErrorCode } from './constants/errors';
import type { DomainErrorCode } from './constants/errors';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Exact two-decimal money. Numbers are used only for counters and time, never amounts. */
export class Money {
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    if (typeof props.amount !== 'string' || !/^\d+\.\d{2}$/.test(props.amount))
      throw new DomainError(FinancialErrorCode.INVALID_AMOUNT);
    if (
      typeof props.currency !== 'string' ||
      !Intl.supportedValuesOf('currency').includes(props.currency)
    )
      throw new DomainError(FinancialErrorCode.INVALID_CURRENCY);

    return Money.signed(BigInt(props.amount.replace('.', '')), props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  private static signed(cents: bigint, currency: string): Money {
    if (cents <= -(10n ** 20n) || cents >= 10n ** 20n)
      throw new DomainError(FinancialErrorCode.AMOUNT_LIMIT_EXCEEDED);

    return new Money(cents, currency);
  }

  private same(other: Money): void {
    if (other.currency !== this.currency)
      throw new DomainError(FinancialErrorCode.CURRENCY_MISMATCH);
  }

  add(other: Money): Money {
    this.same(other);

    return Money.signed(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.same(other);

    return Money.signed(this.cents - other.cents, this.currency);
  }

  negate(): Money {
    return Money.signed(-this.cents, this.currency);
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isLessThan(other: Money): boolean {
    this.same(other);

    return this.cents < other.cents;
  }

  equals(other: Money): boolean {
    this.same(other);

    return this.cents === other.cents;
  }

  toString(): string {
    const absolute = this.cents < 0n ? -this.cents : this.cents;

    return `${this.cents < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }
}
