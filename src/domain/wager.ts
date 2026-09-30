import { DomainError, type Money } from './money';
import type { LedgerDirection } from './types/wallet';
import type { WagerKind, WagerStatus, WagerState } from './types/wager';

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
      (props.kind === 'REFUND' || props.kind === 'ROLLBACK') &&
      !props.referenceExternalTransactionId
    )
      throw new DomainError('REFERENCE_REQUIRED');
    if (props.money.isNegative() || (props.kind !== 'LOSS' && !props.money.isPositive()))
      throw new DomainError('INVALID_AMOUNT');

    return new WagerTransaction({ ...props, status: 'PENDING' });
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
    return ['PROCESSED', 'REJECTED', 'FAILED'].includes(this.status);
  }

  affectsBalance(): boolean {
    return this.kind !== 'LOSS';
  }

  requiresReference(): boolean {
    return this.kind === 'REFUND' || this.kind === 'ROLLBACK';
  }

  matchesPayload(hash: string): boolean {
    return hash === this.payloadHash;
  }

  private transition(status: WagerStatus, extra: Partial<WagerState> = {}): void {
    if (this.isTerminal()) throw new DomainError('INVALID_TRANSACTION_STATE');

    this.state = {
      ...this.state,
      ...extra,
      status,
      processedAt: extra.processedAt ? new Date(extra.processedAt) : this.state.processedAt,
    };
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.transition('PROCESSED', { referenceTransactionId, processedAt: at });
  }

  markPendingReference(): void {
    this.transition('PENDING_REFERENCE');
  }

  reject(failureCode: string): void {
    this.transition('REJECTED', { failureCode });
  }

  fail(failureCode: string): void {
    this.transition('FAILED', { failureCode });
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === 'BET') return 'DEBIT';
    if (this.kind === 'ROLLBACK') {
      if (!reference) throw new DomainError('REFERENCE_REQUIRED');

      return reference.ledgerDirectionFor() === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    }

    return 'CREDIT';
  }

  validateReference(reference: WagerTransaction): string | undefined {
    if (
      reference.providerId !== this.providerId ||
      reference.playerId !== this.playerId ||
      reference.walletId !== this.walletId ||
      reference.roundId !== this.roundId ||
      reference.money.currency !== this.money.currency
    )
      return 'REFERENCE_CONTEXT_MISMATCH';

    const allowed = this.kind === 'ROLLBACK' ? ['BET', 'WIN', 'REFUND'] : ['BET'];

    if (!allowed.includes(reference.kind)) return 'REFERENCE_KIND_INVALID';
    if (this.requiresReference() && !this.money.equals(reference.money))
      return 'REFERENCE_AMOUNT_MISMATCH';
    if (reference.isTerminal() && reference.status !== 'PROCESSED')
      return 'REFERENCE_NOT_PROCESSED';

    return undefined;
  }
}
