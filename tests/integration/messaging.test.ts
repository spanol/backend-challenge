import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { Workers, consumeEventOnce } from '../../src/infrastructure/messaging/workers';
import { WageringService } from '../../src/application/wagering';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { Money } from '../../src/domain/money';
import { newId, parseCommand, PermanentInfrastructureError } from '../../src/application/contracts';
import { requireTestIsolation } from '../helpers/isolated-environment';

let rt: Runtime;

beforeAll(async () => {
  requireTestIsolation();
  rt = await createRuntime();
});
afterAll(async () => {
  if (rt) {
    await rt.workers.stop();
    await rt.db.close(true);
    rt.client.destroy();
  }
});

async function scenario(kind = 'BET', amount = '25.00', reference?: string) {
  const playerId = newId();

  const w = (await rt.service.openWallet(
    playerId,
    Money.from({ amount: '100.00', currency: 'BRL' }),
    { correlationId: newId() },
  )) as { walletId: string };

  return parseCommand(
    {
      walletId: w.walletId,
      playerId,
      providerId: 'sqs-test',
      externalTransactionId: newId(),
      roundId: 'round',
      gameId: 'game',
      kind,
      money: { amount, currency: 'BRL' },
      ...(reference ? { referenceExternalTransactionId: reference } : {}),
    },
    newId(),
  );
}

async function send(command: ReturnType<typeof parseCommand>, messageId = newId()) {
  await rt.client.send(
    new SendMessageCommand({
      QueueUrl: rt.queues.requests,
      MessageBody: JSON.stringify({
        messageId,
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: command,
      }),
      MessageGroupId: command.walletId,
      MessageDeduplicationId: newId(),
    }),
  );

  return messageId;
}

test('HTTP/use case then SQS replay creates one persistent inbox and no extra financial effect', async () => {
  const command = await scenario();
  const direct = await rt.service.process(command, { correlationId: newId() });
  const messageId = await send(command);

  expect(await rt.workers.consumeOnce()).toBe(1);

  await send(command, messageId);
  await rt.workers.consumeOnce();

  const entries = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM inbox WHERE consumer_name=? AND message_id=?',
      ['wager-transactions', messageId],
    );

  expect(entries[0]!.count).toBe('1');
  expect((await rt.queries.reconciliation(command.walletId)).checkedEntries).toBe(2);
  expect((await rt.queries.transaction(direct.transactionId)).balance.amount).toBe('75.00');

  const response = await rt.client.send(
    new ReceiveMessageCommand({ QueueUrl: rt.queues.requests, WaitTimeSeconds: 1 }),
  );

  expect(response.Messages ?? []).toHaveLength(0);
});

test('permanent malformed message is audited and dead-lettered before acknowledgement', async () => {
  const response = await rt.client.send(
    new SendMessageCommand({
      QueueUrl: rt.queues.requests,
      MessageBody: '{invalid',
      MessageGroupId: newId(),
      MessageDeduplicationId: newId(),
    }),
  );

  await rt.workers.consumeOnce();

  const dlq = await rt.client.send(
    new ReceiveMessageCommand({
      QueueUrl: rt.queues.dlq,
      WaitTimeSeconds: 1,
      MessageAttributeNames: ['All'],
    }),
  );

  expect(dlq.Messages).toHaveLength(1);
  expect(dlq.Messages![0]!.MessageAttributes!.failureCode!.StringValue).toBe(
    'INVALID_MESSAGE_JSON',
  );

  const audit = await rt.db.em
    .fork()
    .execute<{ failure_code: string }[]>(
      'SELECT failure_code FROM failed_deliveries WHERE message_id=?',
      [response.MessageId!],
    );

  expect(audit[0]!.failure_code).toBe('INVALID_MESSAGE_JSON');

  await rt.client.send(
    new DeleteMessageCommand({
      QueueUrl: rt.queues.dlq,
      ReceiptHandle: dlq.Messages![0]!.ReceiptHandle!,
    }),
  );
});

test('persistent inbox rejects messageId reused with another payload', async () => {
  const command = await scenario();
  const messageId = await send(command);

  await rt.workers.consumeOnce();
  await send({ ...command, money: { amount: '30.00', currency: 'BRL' } }, messageId);
  await rt.workers.consumeOnce();

  const audit = await rt.db.em
    .fork()
    .execute<{ failure_code: string }[]>(
      'SELECT failure_code FROM failed_deliveries WHERE message_id=?',
      [messageId],
    );

  expect(audit[0]!.failure_code).toBe('MESSAGE_PAYLOAD_CONFLICT');
  expect((await rt.queries.reconciliation(command.walletId)).storedBalance.amount).toBe('75.00');

  const dlq = await rt.client.send(
    new ReceiveMessageCommand({ QueueUrl: rt.queues.dlq, WaitTimeSeconds: 1 }),
  );

  for (const m of dlq.Messages ?? [])
    await rt.client.send(
      new DeleteMessageCommand({ QueueUrl: rt.queues.dlq, ReceiptHandle: m.ReceiptHandle! }),
    );
});

test('accepted pending transaction can become FAILED after a permanent infrastructure failure', async () => {
  const command = await scenario('REFUND', '25.00', newId());

  const failedService = new WageringService(new MikroFinancialUnitOfWork(rt.db), undefined, {
    afterCommit: () => {
      throw new PermanentInfrastructureError();
    },
  });

  const worker = new Workers(rt.db, rt.client, rt.queues, failedService);

  await send(command);
  await worker.consumeOnce();

  const accepted = await rt.queries.byKey(command.idempotencyKey);

  expect(accepted!.status).toBe('FAILED');
  expect((await rt.queries.reconciliation(command.walletId)).checkedEntries).toBe(1);

  const dlq = await rt.client.send(
    new ReceiveMessageCommand({ QueueUrl: rt.queues.dlq, WaitTimeSeconds: 1 }),
  );

  for (const m of dlq.Messages ?? [])
    await rt.client.send(
      new DeleteMessageCommand({ QueueUrl: rt.queues.dlq, ReceiptHandle: m.ReceiptHandle! }),
    );
});

test('transient failures are retried and redriven after five attempts; DLQ remains durable and audited', async () => {
  const command = await scenario();
  let attempts = 0;

  const transient = new WageringService(new MikroFinancialUnitOfWork(rt.db), undefined, {
    beforeCommit: () => {
      attempts++;

      throw new Error('transient database failure');
    },
  });

  const previous = process.env.SQS_VISIBILITY_SECONDS;

  process.env.SQS_VISIBILITY_SECONDS = '1';

  const worker = new Workers(rt.db, rt.client, rt.queues, transient);

  if (previous === undefined) delete process.env.SQS_VISIBILITY_SECONDS;
  else process.env.SQS_VISIBILITY_SECONDS = previous;

  const messageId = await send(command);
  let depth = 0;

  for (let n = 0; n < 15 && depth === 0; n++) {
    await worker.consumeOnce();

    const attrs = await rt.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: rt.queues.dlq,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );

    depth = Number(attrs.Attributes!.ApproximateNumberOfMessages);

    if (!depth) await Bun.sleep(1100);
  }

  expect(attempts).toBe(5);
  expect(depth).toBe(1);
  expect(await rt.queries.byKey(command.idempotencyKey)).toBeNull();
  expect(await rt.workers.auditDlqOnce()).toBe(1);

  const audit = await rt.db.em
    .fork()
    .execute<{ failure_code: string }[]>(
      'SELECT failure_code FROM failed_deliveries WHERE message_id=?',
      [messageId],
    );

  expect(audit[0]!.failure_code).toBe('RETRY_EXHAUSTED');
  expect((await rt.queries.reconciliation(command.walletId)).checkedEntries).toBe(1);

  const dlq = await rt.client.send(
    new ReceiveMessageCommand({ QueueUrl: rt.queues.dlq, WaitTimeSeconds: 1 }),
  );

  expect(dlq.Messages).toHaveLength(1);

  await rt.client.send(
    new DeleteMessageCommand({
      QueueUrl: rt.queues.dlq,
      ReceiptHandle: dlq.Messages![0]!.ReceiptHandle!,
    }),
  );
});

test('outbox survives send failure and two independent publishers deliver all events', async () => {
  const command = await scenario();

  await rt.service.process(command, { correlationId: newId() });

  let crash = true;

  const crashing = new Workers(rt.db, rt.client, rt.queues, rt.service, undefined, {
    afterPublish: () => {
      if (crash) {
        crash = false;

        throw new Error('send completed, mark failed');
      }
    },
  });

  await crashing.publishOnce();

  const retry = await rt.db.em
    .fork()
    .execute<{ id: string }[]>('SELECT id FROM outbox WHERE attempts>0 AND published_at IS NULL');

  expect(retry.length).toBeGreaterThan(0);

  // The injected-clock expiry scenario generated a future-dated event; bring only fixture scheduling forward.
  await rt.db.em
    .fork()
    .execute('UPDATE outbox SET next_attempt_at=now() WHERE published_at IS NULL');

  const other = new Workers(rt.db, rt.client, rt.queues, rt.service);

  for (let n = 0; n < 30; n++) {
    const count = await Promise.all([rt.workers.publishOnce(), other.publishOnce()]);

    if (count.every((c) => c === 0)) break;
  }

  const unpublished = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM outbox WHERE published_at IS NULL',
    );

  expect(unpublished[0]!.count).toBe('0');

  // A downstream effect and its receipt commit together, even after a duplicate event delivery.
  const eventId = retry[0]!.id;

  const effect = async (
    em: import('../../src/infrastructure/persistence/types/database').SqlManager,
  ) => {
    await em.execute('INSERT INTO event_receipts(consumer_name,event_id) VALUES (?,?)', [
      'projection-effect',
      eventId,
    ]);
  };

  expect(await consumeEventOnce(rt.db, 'projection', eventId, effect)).toBe(true);
  expect(await consumeEventOnce(rt.db, 'projection', eventId, effect)).toBe(false);

  const effects = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM event_receipts WHERE consumer_name=? AND event_id=?',
      ['projection-effect', eventId],
    );

  expect(effects[0]!.count).toBe('1');

  const attributes = await rt.client.send(
    new GetQueueAttributesCommand({
      QueueUrl: rt.queues.events,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }),
  );

  expect(Number(attributes.Attributes!.ApproximateNumberOfMessages)).toBeGreaterThan(0);
});
