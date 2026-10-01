import { expect, test } from 'bun:test';
import {
  toPublicProcessingResult,
  toStoredResult,
} from '../../src/application/mappers/wager-result.mapper';
import { toWalletView } from '../../src/application/mappers/wallet-view.mapper';
import { Money } from '../../src/domain/money';

test('stored wager result keeps snapshot data private from its public projection', () => {
  const stored = toStoredResult(
    { id: 'transaction-1', status: 'PROCESSED', failureCode: undefined },
    { balance: Money.from({ amount: '75.00', currency: 'BRL' }), version: 4 },
  );

  expect(stored).toEqual({
    transactionId: 'transaction-1',
    status: 'PROCESSED',
    balance: { amount: '75.00', currency: 'BRL' },
    snapshotVersion: 4,
  });
  expect(toPublicProcessingResult(stored)).toEqual({
    transactionId: 'transaction-1',
    status: 'PROCESSED',
    balance: { amount: '75.00', currency: 'BRL' },
  });
});

test('wallet view mapper serializes money consistently', () => {
  expect(
    toWalletView({
      walletId: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: Money.from({ amount: '0.00', currency: 'BRL' }),
      version: 1,
    }),
  ).toEqual({
    walletId: 'wallet-1',
    playerId: 'player-1',
    currency: 'BRL',
    balance: { amount: '0.00', currency: 'BRL' },
    version: 1,
  });
});
