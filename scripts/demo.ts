import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { newId } from '../src/application/contracts';
import { resolveQueues, sqsClient } from '../src/infrastructure/messaging/sqs';

const api = process.env.API_URL ?? 'http://127.0.0.1:3000';

async function post(path: string, body: unknown, key?: string) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Demo request failed: ${response.status}`);

  return response.json() as Promise<{
    walletId: string;
    transactionId: string;
    status: string;
    idempotentReplay?: boolean;
  }>;
}

const playerId = newId();

const wallet = await post('/wallets', {
  playerId,
  initialBalance: { amount: '100.00', currency: 'BRL' },
});

const key = newId();

const bet = {
  providerId: 'demo-provider',
  externalTransactionId: newId(),
  playerId,
  walletId: wallet.walletId,
  roundId: 'demo-round',
  gameId: 'demo-game',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

const processed = await post('/wagering/transactions', bet, key);
const replay = await post('/wagering/transactions', bet, key);
const client = sqsClient();

try {
  const queues = await resolveQueues(client);

  await client.send(
    new SendMessageCommand({
      QueueUrl: queues.requests,
      MessageBody: JSON.stringify({
        messageId: newId(),
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: { ...bet, idempotencyKey: key },
      }),
      MessageGroupId: wallet.walletId,
      MessageDeduplicationId: newId(),
    }),
  );
} finally {
  client.destroy();
}

await post(
  '/wagering/transactions',
  {
    ...bet,
    externalTransactionId: newId(),
    kind: 'LOSS',
    money: { amount: '0.00', currency: 'BRL' },
  },
  newId(),
);

const reconciliation = await post(`/wallets/${wallet.walletId}/reconciliation`, {});

console.log(
  JSON.stringify(
    {
      walletId: wallet.walletId,
      transactionId: processed.transactionId,
      idempotentReplay: replay.idempotentReplay,
      sqsDuplicateSent: true,
      reconciliation,
    },
    null,
    2,
  ),
);
