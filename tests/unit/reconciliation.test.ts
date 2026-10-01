import { expect, test } from 'bun:test';
import { WageringQueries } from '../../src/infrastructure/persistence/queries';
import type { Database } from '../../src/infrastructure/persistence/types/database';

test('legacy divergence is returned and reported without silently correcting money', async () => {
  const statements: string[] = [];
  const reported: object[] = [];

  // A legacy/corrupt read snapshot; the normal runtime SQL role cannot manufacture this state.
  const db = {
    em: {
      fork: () => ({
        execute: (sql: string) => {
          statements.push(sql);

          return Promise.resolve([
            { balance: '9.00', currency: 'BRL', calculated: '10.00', entries: '1' },
          ]);
        },
      }),
    },
  } as unknown as Database;

  const result = await new WageringQueries(db, (context) => reported.push(context)).reconciliation(
    'wallet',
  );

  expect(result.consistent).toBe(false);
  expect(result.difference.amount).toBe('-1.00');
  expect(result.storedBalance.amount).toBe('9.00');
  expect(reported).toEqual([{ walletId: 'wallet', checkedEntries: 1 }]);
  expect(statements).toHaveLength(1);
  expect(statements[0]!.trimStart().startsWith('SELECT')).toBe(true);
});
