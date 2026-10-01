import type { Wallet } from '../../domain/wallet';
import type { WagerTransaction } from '../../domain/wager';
import type { StoredResult } from '../types/financial';
import type { ProcessingResult } from '../types/wagering';

export type PublicProcessingResult = Omit<ProcessingResult, 'idempotentReplay'>;

export function toStoredResult(
  transaction: Pick<WagerTransaction, 'id' | 'status' | 'failureCode'>,
  wallet: Pick<Wallet, 'balance' | 'version'>,
): StoredResult {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: wallet.balance.toJSON(),
    snapshotVersion: wallet.version,
    ...(transaction.failureCode ? { failureCode: transaction.failureCode } : {}),
  };
}

export function toPublicProcessingResult(result: StoredResult): PublicProcessingResult {
  return {
    transactionId: result.transactionId,
    status: result.status,
    balance: result.balance,
    ...(result.failureCode === undefined ? {} : { failureCode: result.failureCode }),
  };
}
