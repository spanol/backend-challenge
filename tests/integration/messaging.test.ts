import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { Workers, consumeEventOnce } from '../../src/infrastructure/messaging/workers';
import { WageringService } from '../../src/application/wagering';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { Money } from '../../src/domain/money';
import { WagerStatus } from '../../src/domain/constants/wager';
import { newId, parseCommand, PermanentInfrastructureError } from '../../src/application/contracts';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { assertReconciled } from '../helpers/reconciliation';

let rt: Runtime;
const walletIds = new Set<string>();

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

afterEach(async () => {
  await assertReconciled(rt.queries, walletIds);
  walletIds.clear();
});

async function scenario(kind = 'BET', amount = '25.00', reference?: string) {
  const playerId = newId();

  const w = (await rt.service.openWallet(
    playerId,
    Money.from({ amount: '100.00', currency: 'BRL' }),
    { correlationId: newId() },
  )) as { walletId: string };

  walletIds.add(w.walletId);

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

function deferred<T>() {
  let resolve!: (value: T) => void;

  return {
    promise: new Promise<T>((done) => (resolve = done)),
    resolve,
  };
}

test('a message returned by an in-flight poll after stop is released without processing', async () => {
  const command = await scenario();
  const pollStarted = deferred<void>();
  const receive = deferred<{
    Messages: { MessageId: string; ReceiptHandle: string; Body: string }[];
  }>();
  const released: ChangeMessageVisibilityCommand[] = [];
  const client = {
    send: (request: unknown) => {
      if (request instanceof ReceiveMessageCommand) {
        pollStarted.resolve();

        return receive.promise;
      }
      if (request instanceof ChangeMessageVisibilityCommand) {
        released.push(request);

        return Promise.resolve({});
      }

      throw new Error('Unexpected SQS command');
    },
  } as unknown as SQSClient;
  const worker = new Workers(rt.db, client, rt.queues, rt.service);
  const poll = worker.consumeOnce();

  await pollStarted.promise;
  await worker.stop();
  receive.resolve({
    Messages: [
      {
        MessageId: newId(),
        ReceiptHandle: 'receipt-after-stop',
        Body: JSON.stringify({
          messageId: newId(),
          type: 'WagerTransactionRequested',
          occurredAt: new Date().toISOString(),
          data: command,
        }),
      },
    ],
  });

  expect(await poll).toBe(0);
  expect(released.map(({ input }) => input)).toEqual([
    {
      QueueUrl: rt.queues.requests,
      ReceiptHandle: 'receipt-after-stop',
      VisibilityTimeout: 0,
    },
  ]);
  expect(await rt.queries.byKey(command.idempotencyKey)).toBeNull();
});

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

test('a DLQ send failure leaves the poison message available for retry', async () => {
  const response = await rt.client.send(
    new SendMessageCommand({
      QueueUrl: rt.queues.requests,
      MessageBody: '{invalid-dlq-retry',
      MessageGroupId: newId(),
      MessageDeduplicationId: newId(),
    }),
  );
  let receiptHandle = '';
  let failDlqSend = true;
  const client = {
    send: async (request: unknown) => {
      if (request instanceof ReceiveMessageCommand) {
        const received = await rt.client.send(request);

        receiptHandle = received.Messages?.[0]?.ReceiptHandle ?? '';

        return received;
      }
      if (
        request instanceof SendMessageCommand &&
        request.input.QueueUrl === rt.queues.dlq &&
        failDlqSend
      ) {
        failDlqSend = false;

        throw new Error('simulated DLQ outage');
      }

      return rt.client.send(request as never);
    },
  } as unknown as SQSClient;
  const worker = new Workers(rt.db, client, rt.queues, rt.service);

  // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun 1.4.2 types rejects matchers as void; runtime must await them.
  await expect(worker.consumeOnce()).rejects.toThrow('simulated DLQ outage');
  expect(receiptHandle).not.toBe('');
  await rt.client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: rt.queues.requests,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0,
    }),
  );

  expect(await worker.consumeOnce()).toBe(1);

  const dlq = await rt.client.send(
    new ReceiveMessageCommand({
      QueueUrl: rt.queues.dlq,
      WaitTimeSeconds: 1,
      MessageAttributeNames: ['All'],
    }),
  );

  expect(dlq.Messages).toHaveLength(1);
  expect(dlq.Messages![0]!.MessageAttributes!.originalMessageId!.StringValue).toBe(
    response.MessageId,
  );
  const audits = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM failed_deliveries WHERE message_id=?',
      [response.MessageId!],
    );

  expect(audits[0]!.count).toBe('1');
  await rt.client.send(
    new DeleteMessageCommand({
      QueueUrl: rt.queues.dlq,
      ReceiptHandle: dlq.Messages![0]!.ReceiptHandle!,
    }),
  );
});

test('a failed DeleteMessage after commit replays without another financial effect', async () => {
  const command = await scenario();
  const messageId = newId();

  await send(command, messageId);

  let receiptHandle = '';
  let failDelete = true;
  const client = {
    send: async (request: unknown) => {
      if (request instanceof ReceiveMessageCommand) {
        const received = await rt.client.send(request);

        receiptHandle = received.Messages?.[0]?.ReceiptHandle ?? '';

        return received;
      }
      if (
        request instanceof DeleteMessageCommand &&
        request.input.QueueUrl === rt.queues.requests &&
        failDelete
      ) {
        failDelete = false;

        throw new Error('simulated acknowledgement outage');
      }

      return rt.client.send(request as never);
    },
  } as unknown as SQSClient;
  const worker = new Workers(rt.db, client, rt.queues, rt.service);

  expect(await worker.consumeOnce()).toBe(1);
  expect((await rt.queries.byKey(command.idempotencyKey))!.status).toBe(WagerStatus.PROCESSED);
  await rt.client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: rt.queues.requests,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0,
    }),
  );

  expect(await worker.consumeOnce()).toBe(1);

  const inbox = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM inbox WHERE consumer_name=? AND message_id=?',
      ['wager-transactions', messageId],
    );
  const entries = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM wallet_ledger WHERE wallet_id=?',
      [command.walletId],
    );
  const outbox = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      "SELECT count(*)::text count FROM outbox WHERE payload->'data'->>'transactionId'=?",
      [(await rt.queries.byKey(command.idempotencyKey))!.id],
    );

  expect(inbox[0]!.count).toBe('1');
  expect(entries[0]!.count).toBe('2');
  expect(outbox[0]!.count).toBe('2');
  expect((await rt.queries.reconciliation(command.walletId)).storedBalance.amount).toBe('75.00');
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

  expect(accepted!.status).toBe(WagerStatus.FAILED);
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

test.each([
  'partial',
  'missing',
  'request-error',
  'stale-success',
  'stale-failure',
  'stop-after-send',
])('batch publication handles %s without losing or prematurely confirming events', async (mode) => {
  const command = await scenario();

  await rt.service.process(command, { correlationId: newId() });

  const before = await rt.db.em
    .fork()
    .execute<{ id: string; payload: unknown }[]>(
      'SELECT id,payload FROM outbox WHERE aggregate_id=? ORDER BY occurred_at,id',
      [command.walletId],
    );
  const target = before[0]!.id;
  const replacementToken = newId();
  let intercepted = false;
  let batchSize = 0;
  const client = {
    send: async (request: unknown) => {
      if (!(request instanceof SendMessageBatchCommand)) return rt.client.send(request as never);

      intercepted = true;
      batchSize = request.input.Entries!.length;

      if (mode === 'request-error') throw new Error('injected broker request failure');

      const rejectTarget = mode === 'partial' || mode === 'stale-failure';
      const response = await rt.client.send(
        new SendMessageBatchCommand({
          ...request.input,
          Entries: request.input.Entries!.filter((entry) => !rejectTarget || entry.Id !== target),
        }),
      );

      if (mode === 'stop-after-send') await worker.stop();

      if (mode.startsWith('stale-'))
        await rt.db.em
          .fork()
          .execute(
            "UPDATE outbox SET lease_token=?,lease_until=now()+interval '30 seconds' WHERE id=?",
            [replacementToken, target],
          );

      return {
        ...response,
        Successful: response.Successful?.filter(
          (entry) => mode !== 'missing' || entry.Id !== target,
        ),
        Failed: rejectTarget
          ? [{ Id: target, Code: 'ServiceUnavailable', SenderFault: false }]
          : response.Failed,
      };
    },
  } as unknown as SQSClient;
  const worker = new Workers(rt.db, client, rt.queues, rt.service);

  await worker.publishOnce();

  expect(intercepted).toBe(true);
  expect(batchSize).toBeGreaterThan(1);
  expect(batchSize).toBeLessThanOrEqual(10);

  const rows = await rt.db.em.fork().execute<
    {
      id: string;
      published_at: Date | null;
      lease_token: string | null;
      attempts: number;
      next_attempt_at: string;
      payload: unknown;
    }[]
  >('SELECT * FROM outbox WHERE aggregate_id=? ORDER BY occurred_at,id', [command.walletId]);

  for (const row of rows) {
    expect(row.payload).toEqual(before.find((event) => event.id === row.id)!.payload);

    if (mode !== 'stop-after-send' && (row.id === target || mode === 'request-error')) {
      expect(row.published_at).toBeNull();
      expect(row.attempts).toBe(mode.startsWith('stale-') ? 0 : 1);
      expect(row.lease_token).toBe(mode.startsWith('stale-') ? replacementToken : null);

      if (!mode.startsWith('stale-'))
        expect(Date.parse(row.next_attempt_at)).toBeGreaterThan(Date.now());
    } else {
      expect(row.published_at).not.toBeNull();
      expect(row.attempts).toBe(0);
      expect(row.lease_token).toBeNull();
    }
  }

  // Advance only scheduling of this test's durable events; the next publisher must recover them.
  await rt.db.em
    .fork()
    .execute(
      "UPDATE outbox SET next_attempt_at=now(),lease_until=now()-interval '1 second' WHERE aggregate_id=? AND published_at IS NULL",
      [command.walletId],
    );

  for (let i = 0; i < 20; i++) if ((await rt.workers.publishOnce()) === 0) break;

  const [remaining] = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT count(*)::text count FROM outbox WHERE aggregate_id=? AND published_at IS NULL',
      [command.walletId],
    );

  expect(remaining!.count).toBe('0');

  if (mode === 'stop-after-send') expect(await worker.publishOnce()).toBe(0);
});
