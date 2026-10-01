export enum WagerKind {
  OPENING = 'OPENING',
  BET = 'BET',
  WIN = 'WIN',
  LOSS = 'LOSS',
  REFUND = 'REFUND',
  ROLLBACK = 'ROLLBACK',
}

export enum WagerStatus {
  PENDING = 'PENDING',
  PENDING_REFERENCE = 'PENDING_REFERENCE',
  PROCESSED = 'PROCESSED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export const wagerKinds = [
  WagerKind.BET,
  WagerKind.WIN,
  WagerKind.LOSS,
  WagerKind.REFUND,
  WagerKind.ROLLBACK,
] as const;

export const terminalWagerStatuses = [
  WagerStatus.PROCESSED,
  WagerStatus.REJECTED,
  WagerStatus.FAILED,
] as const;

export const failedWagerStatuses = [WagerStatus.REJECTED, WagerStatus.FAILED] as const;

export const directReversalKinds = [WagerKind.REFUND, WagerKind.ROLLBACK] as const;

export const rollbackReferenceKinds = [WagerKind.BET, WagerKind.WIN, WagerKind.REFUND] as const;

export const creditedReferenceKinds = [WagerKind.WIN, WagerKind.REFUND] as const;
