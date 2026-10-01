import { expect } from 'bun:test';
import type { WageringQueries } from '../../src/infrastructure/persistence/queries';

export async function assertReconciled(
  queries: WageringQueries,
  walletIds: Iterable<string>,
): Promise<void> {
  for (const walletId of walletIds) {
    const result = await queries.reconciliation(walletId);

    expect(result.walletId).toBe(walletId);
    expect(result.consistent).toBe(true);
    expect(result.calculatedBalance).toEqual(result.storedBalance);
    expect(result.difference).toEqual({ amount: '0.00', currency: result.storedBalance.currency });
  }
}
