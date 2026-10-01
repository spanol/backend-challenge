import { DomainError, type Money } from './money';
import { FinancialErrorCode } from './constants/errors';
import type { WagerFailureCode } from './constants/errors';
import { WagerKind, WagerStatus, rollbackReferenceKinds } from './constants/wager';
import { LedgerDirection } from './constants/wallet';
import type { WagerState } from './types/wager';

export class WagerTransaction {
  private constructor(private state: WagerState) {
    this.state = {
      ...state,
      createdAt: new Date(state.createdAt),
      processedAt: state.processedAt && new Date(state.processedAt),
    };
  }

  static create(props: Omit<WagerState, 'status'>): WagerTransaction {
    if (
      (props.kind === WagerKind.REFUND || props.kind === WagerKind.ROLLBACK) &&
      !props.referenceExternalTransactionId
    )
      throw new DomainError(FinancialErrorCode.REFERENCE_REQUIRED);
    if (props.money.isNegative() || (props.kind !== WagerKind.LOSS && !props.money.isPositive()))
      throw new DomainError(FinancialErrorCode.INVALID_AMOUNT);

    return new WagerTransaction({ ...props, status: WagerStatus.PENDING });
  }

  static rehydrate(state: WagerState): WagerTransaction {
    return new WagerTransaction({ ...state });
  }

  get id(): string {
    return this.state.id;
  }

  get providerId(): string {
    return this.state.providerId;
  }

  get externalTransactionId(): string {
    return this.state.externalTransactionId;
  }

  get idempotencyKey(): string {
    return this.state.idempotencyKey;
  }

  get payloadHash(): string {
    return this.state.payloadHash;
  }

  get walletId(): string {
    return this.state.walletId;
  }

  get playerId(): string {
    return this.state.playerId;
  }

  get roundId(): string {
    return this.state.roundId;
  }

  get gameId(): string {
    return this.state.gameId;
  }

  get kind(): WagerKind {
    return this.state.kind;
  }

  get money(): Money {
    return this.state.money;
  }

  get status(): WagerStatus {
    return this.state.status;
  }

  get createdAt(): Date {
    return new Date(this.state.createdAt);
  }

  get processedAt(): Date | undefined {
    return this.state.processedAt && new Date(this.state.processedAt);
  }

  get referenceExternalTransactionId(): string | undefined {
    return this.state.referenceExternalTransactionId;
  }

  get referenceTransactionId(): string | undefined {
    return this.state.referenceTransactionId;
  }

  get failureCode(): string | undefined {
    return this.state.failureCode;
  }

  isTerminal(): boolean {
    return [WagerStatus.PROCESSED, WagerStatus.REJECTED, WagerStatus.FAILED].includes(this.status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerKind.LOSS;
  }

  requiresReference(): boolean {
    return this.kind === WagerKind.REFUND || this.kind === WagerKind.ROLLBACK;
  }

  matchesPayload(hash: string): boolean {
    return hash === this.payloadHash;
  }

  private transition(status: WagerStatus, extra: Partial<WagerState> = {}): void {
    if (this.isTerminal()) throw new DomainError(FinancialErrorCode.INVALID_TRANSACTION_STATE);

    this.state = {
      ...this.state,
      ...extra,
      status,
      processedAt: extra.processedAt ? new Date(extra.processedAt) : this.state.processedAt,
    };
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.transition(WagerStatus.PROCESSED, { referenceTransactionId, processedAt: at });
  }

  markPendingReference(): void {
    this.transition(WagerStatus.PENDING_REFERENCE);
  }

  reject(failureCode: WagerFailureCode): void {
    this.transition(WagerStatus.REJECTED, { failureCode });
  }

  fail(failureCode: WagerFailureCode): void {
    this.transition(WagerStatus.FAILED, { failureCode });
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === WagerKind.BET) return LedgerDirection.DEBIT;
    if (this.kind === WagerKind.ROLLBACK) {
      if (!reference) throw new DomainError(FinancialErrorCode.REFERENCE_REQUIRED);

      return reference.ledgerDirectionFor() === LedgerDirection.DEBIT
        ? LedgerDirection.CREDIT
        : LedgerDirection.DEBIT;
    }

    return LedgerDirection.CREDIT;
  }

  validateReference(reference: WagerTransaction): WagerFailureCode | undefined {
    if (
      reference.providerId !== this.providerId ||
      reference.playerId !== this.playerId ||
      reference.walletId !== this.walletId ||
      reference.roundId !== this.roundId ||
      reference.money.currency !== this.money.currency
    )
      return FinancialErrorCode.REFERENCE_CONTEXT_MISMATCH;

    const allowed: readonly WagerKind[] =
      this.kind === WagerKind.ROLLBACK ? rollbackReferenceKinds : [WagerKind.BET];

    if (!allowed.includes(reference.kind)) return FinancialErrorCode.REFERENCE_KIND_INVALID;
    if (this.requiresReference() && !this.money.equals(reference.money))
      return FinancialErrorCode.REFERENCE_AMOUNT_MISMATCH;
    if (reference.isTerminal() && reference.status !== WagerStatus.PROCESSED)
      return FinancialErrorCode.REFERENCE_NOT_PROCESSED;

    return undefined;
  }
}
