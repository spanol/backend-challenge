import { createRuntime } from '../src/infrastructure/runtime';
import { Money } from '../src/domain/money';
import { RequestError } from '../src/application/contracts';
import { ApplicationErrorCode } from '../src/application/constants/errors';
import { WalletRow } from '../src/infrastructure/persistence/entities';

const rt = await createRuntime();
const playerId = '11111111-1111-4111-8111-111111111111';

try {
  let walletId: string;

  try {
    const wallet = (await rt.service.openWallet(
      playerId,
      Money.from({ amount: '1000.00', currency: 'BRL' }),
      { correlationId: 'seed' },
    )) as { walletId: string };

    walletId = wallet.walletId;
  } catch (error) {
    if (
      !(error instanceof RequestError) ||
      error.code !== ApplicationErrorCode.WALLET_ALREADY_EXISTS
    )
      throw error;

    walletId = (await rt.db.em.fork().findOneOrFail(WalletRow, { playerId, currency: 'BRL' })).id;
  }

  console.log(
    JSON.stringify({ event: 'seed_ready', playerId, walletId, providerId: 'demo-provider' }),
  );
} finally {
  await rt.db.close(true);
  rt.client.destroy();
}
