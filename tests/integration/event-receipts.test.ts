import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { EventReceiptConsumer } from '../../src/infrastructure/messaging/event-receipts';
import { ConsumerName } from '../../src/infrastructure/messaging/constants';
import { InfrastructureErrorCode } from '../../src/infrastructure/constants/errors';
import { Money } from '../../src/domain/money';
import { newId, object } from '../../src/application/contracts';
import type { FaultHooks } from '../../src/application/types/execution';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { assertReconciled } from '../helpers/reconciliation';

let rt: Runtime;
let queueUrl: string;
const wallets = new Set<string>();

beforeAll(async () => {
  requireTestIsolation();
  rt = await createRuntime();
  const result = await rt.client.send(
    new CreateQueueCommand({
      QueueName: `${process.env.QUEUE_PREFIX!}event-audit.fifo`,
      Attributes: { FifoQueue: 'true' },
    }),
  );
  queueUrl = result.QueueUrl!;
});

afterAll(async () => {
  if (!rt) return;
  try {
    if (queueUrl) await rt.client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
  } finally {
    await rt.db.close(true);
    rt.client.destroy();
  }
});

afterEach(async () => {
  await assertReconciled(rt.queries, wallets);
  wallets.clear();
});

async function envelope() {
  const wallet = await rt.service.openWallet(
    newId(),
    Money.from({ amount: '100.00', currency: 'BRL' }),
    { correlationId: newId() },
  );
  wallets.add(wallet.walletId);
  const [event] = await rt.db.em
    .fork()
    .execute<{ id: string; payload: unknown }[]>(
      'SELECT id,payload FROM outbox WHERE aggregate_id=? ORDER BY id LIMIT 1',
      [wallet.walletId],
    );
  return event!;
}

async function send(payload: unknown) {
  await rt.client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: newId(),
      MessageDeduplicationId: newId(),
    }),
  );
}

async function receipts(id: string) {
  const [row] = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM event_receipts WHERE consumer_name=? AND event_id=?',
      [ConsumerName.DEMO_EVENT_AUDIT, id],
    );
  return Number(row!.count);
}

function consumer(hooks: FaultHooks = {}, failAck: false | 'missing' | 'failed' = false) {
  const received: Message[] = [];
  let acks = 0;
  const client = {
    send: async (request: unknown) => {
      if (request instanceof ReceiveMessageCommand) {
        const result = await rt.client.send(request);
        received.push(...(result.Messages ?? []));
        return result;
      }
      if (request instanceof DeleteMessageBatchCommand) {
        acks++;
        if (failAck)
          return {
            Successful: [],
            Failed:
              failAck === 'failed' ? [{ Id: '0', Code: 'InternalError', SenderFault: false }] : [],
          };
        return rt.client.send(request);
      }
      if (request instanceof ChangeMessageVisibilityCommand) return rt.client.send(request);
      throw new Error('Unexpected audit command');
    },
  } as unknown as SQSClient;
  return {
    worker: new EventReceiptConsumer(rt.db, client, queueUrl, hooks),
    received,
    acks: () => acks,
  };
}

async function redeliver(messages: Message[]) {
  for (const message of messages)
    await rt.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle!,
        VisibilityTimeout: 0,
      }),
    );
}

test('real SQS receives ACK only after the durable receipt commits', async () => {
  const event = await envelope();
  await send(event.payload);
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const c = consumer({
    beforeCommit: async () => {
      entered();
      await gate;
    },
  });
  const pending = c.worker.consumeOnce();
  await started;
  expect(await receipts(event.id)).toBe(0);
  expect(c.acks()).toBe(0);
  release();
  expect(await pending).toBe(1);
  expect(await receipts(event.id)).toBe(1);
  expect(c.acks()).toBe(1);
});

test('SQL rollback keeps the message available without a receipt or ACK', async () => {
  const event = await envelope();
  await send(event.payload);
  const c = consumer({
    beforeCommit: () => {
      throw new Error('commit interrupted');
    },
  });
  await Promise.resolve(expect(c.worker.consumeOnce()).rejects.toThrow('commit interrupted'));
  expect(await receipts(event.id)).toBe(0);
  expect(c.acks()).toBe(0);
  await redeliver(c.received);
  await new EventReceiptConsumer(rt.db, rt.client, queueUrl).consumeOnce();
  expect(await receipts(event.id)).toBe(1);
});

test('a crash after commit redelivers into the same unique receipt', async () => {
  const event = await envelope();
  await send(event.payload);
  const c = consumer({
    afterCommit: () => {
      throw new Error('response lost');
    },
  });
  await Promise.resolve(expect(c.worker.consumeOnce()).rejects.toThrow('response lost'));
  expect(await receipts(event.id)).toBe(1);
  expect(c.acks()).toBe(0);
  await redeliver(c.received);
  await new EventReceiptConsumer(rt.db, rt.client, queueUrl).consumeOnce();
  expect(await receipts(event.id)).toBe(1);
});

for (const fault of ['missing', 'failed'] as const)
  test(`${fault} ACK confirmation preserves durable receipts for redelivery`, async () => {
    const event = await envelope();
    await send(event.payload);
    const c = consumer({}, fault);
    await Promise.resolve(
      expect(c.worker.consumeOnce()).rejects.toThrow(
        InfrastructureErrorCode.EVENT_AUDIT_ACK_INCOMPLETE,
      ),
    );
    expect(await receipts(event.id)).toBe(1);
    await redeliver(c.received);
    await new EventReceiptConsumer(rt.db, rt.client, queueUrl).consumeOnce();
    expect(await receipts(event.id)).toBe(1);
  });

test('changed envelopes receive no ACK even if their event already has a receipt', async () => {
  const event = await envelope();
  await send(event.payload);
  await new EventReceiptConsumer(rt.db, rt.client, queueUrl).consumeOnce();
  await send({ ...object(event.payload), version: 999 });
  const c = consumer();
  await Promise.resolve(
    expect(c.worker.consumeOnce()).rejects.toThrow(
      InfrastructureErrorCode.EVENT_AUDIT_PAYLOAD_MISMATCH,
    ),
  );
  expect(await receipts(event.id)).toBe(1);
  expect(c.acks()).toBe(0);
  // Remove only the invalid message generated by this fixture, after the proof.
  for (const message of c.received)
    await rt.client.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle! }),
    );
});

test('ten independent events commit and acknowledge as a batch', async () => {
  const events = await Promise.all(Array.from({ length: 10 }, () => envelope()));
  for (const event of events) await send(event.payload);
  const c = consumer();
  expect(await c.worker.consumeOnce()).toBe(10);
  expect(c.acks()).toBe(1);
  expect(await Promise.all(events.map((event) => receipts(event.id)))).toEqual(
    Array<number>(10).fill(1),
  );
});
