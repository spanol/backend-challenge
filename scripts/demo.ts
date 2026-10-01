import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { newId } from '../src/application/contracts';
import { resolveQueues, sqsClient } from '../src/infrastructure/messaging/sqs';

const api = process.env.API_URL ?? 'http://127.0.0.1:3000';

async function post<T = unknown>(path: string, body: unknown, key?: string): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Demo request failed: ${response.status}`);

  return response.json() as Promise<T>;
}

const playerId = newId();

const wallet = await post<{ id: string }>('/wallets', {
  playerId,
  initialBalance: { amount: '100.00', currency: 'BRL' },
});

const key = newId();

const bet = {
  providerId: 'demo-provider',
  externalTransactionId: newId(),
  playerId,
  walletId: wallet.id,
  roundId: 'demo-round',
  gameId: 'demo-game',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

const processed = await post<{ transactionId: string }>('/wagering/transactions', bet, key);
const replay = await post<{ idempotentReplay: boolean }>('/wagering/transactions', bet, key);
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
      MessageGroupId: wallet.id,
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

const reconciliation = await post(`/wallets/${wallet.id}/reconciliation`, {});

console.log(
  JSON.stringify(
    {
      walletId: wallet.id,
      transactionId: processed.transactionId,
      idempotentReplay: replay.idempotentReplay,
      sqsDuplicateSent: true,
      reconciliation,
    },
    null,
    2,
  ),
);
