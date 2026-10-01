import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { Money } from '../../src/domain/money';
import { newId, object, parseCommand } from '../../src/application/contracts';
import { childHarness } from '../helpers/process-harness';
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

async function command(amount = '25.00') {
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
      providerId: 'process-test',
      externalTransactionId: newId(),
      roundId: 'round',
      gameId: 'game',
      kind: 'BET',
      money: { amount, currency: 'BRL' },
    },
    newId(),
  );
}

test('fifty duplicates overlap across three OS processes and independent PostgreSQL sessions', async () => {
  const c = await command();
  const children = Array.from({ length: 3 }, () => childHarness('financial'));

  try {
    const ready = await Promise.all(children.map((child) => child.wait('ready')));

    expect(new Set(ready.map((r) => r.pid)).size).toBe(3);
    expect(new Set(ready.map((r) => r.backendPid)).size).toBe(3);

    children.forEach((child, index) =>
      child.send({
        type: 'prepare',
        config: { commands: Array.from({ length: index === 2 ? 16 : 17 }, () => c) },
      }),
    );
    await Promise.all(children.map((child) => child.wait('armed')));
    children.forEach((child) => child.send({ type: 'execute' }));

    const done = await Promise.all(children.map((child) => child.wait('done')));
    const started = await Promise.all(children.map((child) => child.wait('started')));

    expect(Math.max(...started.map((r) => r.at!))).toBeLessThan(
      Math.min(...done.map((r) => r.at!)),
    );

    const results = done.flatMap((d) => d.results!);

    expect(results).toHaveLength(50);
    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);

    const recon = await rt.queries.reconciliation(c.walletId);

    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance.amount).toBe('75.00');
    expect(recon.checkedEntries).toBe(2);
    expect(await Promise.all(children.map((child) => child.child.exited))).toEqual([0, 0, 0]);
  } finally {
    children.forEach((child) => child.kill());
  }
});

test('competing debits in separate processes reject one, while a third independent wallet proceeds', async () => {
  const c = await command('80.00');
  const other = await command('80.00');
  const children = Array.from({ length: 3 }, () => childHarness('financial'));

  try {
    await Promise.all(children.map((child) => child.wait('ready')));

    const commands = [c, { ...c, idempotencyKey: newId(), externalTransactionId: newId() }, other];

    children.forEach((child, index) =>
      child.send({ type: 'prepare', config: { commands: [commands[index]] } }),
    );
    await Promise.all(children.map((child) => child.wait('armed')));
    children.forEach((child) => child.send({ type: 'execute' }));

    const done = await Promise.all(children.map((child) => child.wait('done')));
    const results = done.slice(0, 2).flatMap((d) => d.results!);

    expect(results.map((r) => r.status).sort()).toEqual(['PROCESSED', 'REJECTED']);
    expect(done[2]!.results![0]!.status).toBe('PROCESSED');

    const recon = await rt.queries.reconciliation(c.walletId);

    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance.amount).toBe('20.00');
    expect(recon.checkedEntries).toBe(2);
    expect(await Promise.all(children.map((child) => child.child.exited))).toEqual([0, 0, 0]);
  } finally {
    children.forEach((child) => child.kill());
  }
});

test('locking one wallet does not block another wallet in another process', async () => {
  const blocked = await command();
  const free = await command();
  const first = childHarness('financial');
  const second = childHarness('financial');

  try {
    await Promise.all([first.wait('ready'), second.wait('ready')]);
    first.send({ type: 'prepare', config: { commands: [blocked], hold: true } });
    second.send({ type: 'prepare', config: { commands: [free] } });
    await Promise.all([first.wait('armed'), second.wait('armed')]);
    first.send({ type: 'execute' });
    await first.wait('commit-entered');
    second.send({ type: 'execute' });

    const completed = await second.wait('done');

    expect(completed.results![0]!.status).toBe('PROCESSED');
    expect(first.events.some((e) => e.type === 'done')).toBe(false);

    first.send({ type: 'release' });
    await first.wait('done');
    await Promise.all([first.child.exited, second.child.exited]);
  } finally {
    first.kill();
    second.kill();
  }
});

test('process dies after SQL commit before SQS ACK; redelivery replays without another debit', async () => {
  const c = await command();
  const messageId = newId();

  await rt.client.send(
    new SendMessageCommand({
      QueueUrl: rt.queues.requests,
      MessageBody: JSON.stringify({
        messageId,
        type: 'WagerTransactionRequested',
        occurredAt: new Date().toISOString(),
        data: c,
      }),
      MessageGroupId: c.walletId,
      MessageDeduplicationId: newId(),
    }),
  );

  const child = childHarness('crash-consumer');

  try {
    await child.wait('ready');
    child.send({ type: 'execute' });
    await child.wait('committed');

    expect(await child.child.exited).toBe(91);

    const row = await rt.queries.byKey(c.idempotencyKey);

    expect(row!.status).toBe('PROCESSED');

    await Bun.sleep(1100);

    expect(await rt.workers.consumeOnce()).toBe(1);

    const recon = await rt.queries.reconciliation(c.walletId);

    expect(recon.checkedEntries).toBe(2);
    expect(recon.storedBalance.amount).toBe('75.00');
    expect(recon.consistent).toBe(true);

    const inbox = await rt.db.em
      .fork()
      .execute<{ count: string }[]>('SELECT count(*)::text count FROM inbox WHERE message_id=?', [
        messageId,
      ]);

    expect(inbox[0]!.count).toBe('1');
  } finally {
    child.kill();
  }
});

test('two OS publisher processes claim different batches and publish all durable events', async () => {
  // Ensure enough events for both publishers, regardless of earlier scenario ordering.
  for (let i = 0; i < 12; i++) {
    const c = await command();

    await rt.service.process(c, { correlationId: newId() });
  }

  const children = [childHarness('publisher'), childHarness('publisher')];

  try {
    await Promise.all(children.map((child) => child.wait('ready')));
    children.forEach((child) => child.send({ type: 'prepare', config: { hold: true } }));
    await Promise.all(children.map((child) => child.wait('armed')));
    children.forEach((child) => child.send({ type: 'execute' }));
    await Promise.all(children.map((child) => child.wait('published')));
    children.forEach((child) => child.send({ type: 'release' }));

    const done = await Promise.all(children.map((child) => child.wait('done')));

    expect(done.every((r) => r.total! > 0)).toBe(true);

    await Promise.all(children.map((child) => child.child.exited));

    const rows = await rt.db.em
      .fork()
      .execute<{ count: string }[]>(
        'SELECT count(*)::text count FROM outbox WHERE published_at IS NULL',
      );

    expect(rows[0]!.count).toBe('0');
  } finally {
    children.forEach((child) => child.kill());
  }
});

test('reference-before-parent is acknowledged and resumed by a newly started worker process', async () => {
  const bet = await command();

  const refund = {
    ...bet,
    kind: 'REFUND' as const,
    idempotencyKey: newId(),
    externalTransactionId: newId(),
    referenceExternalTransactionId: bet.externalTransactionId,
  };

  async function deliver(c: typeof bet) {
    await rt.client.send(
      new SendMessageCommand({
        QueueUrl: rt.queues.requests,
        MessageBody: JSON.stringify({
          messageId: newId(),
          type: 'WagerTransactionRequested',
          occurredAt: new Date().toISOString(),
          data: c,
        }),
        MessageGroupId: c.walletId,
        MessageDeduplicationId: newId(),
      }),
    );

    const child = childHarness('consumer');

    try {
      await child.wait('ready');
      child.send({ type: 'execute' });
      await child.wait('done');

      expect(await child.child.exited).toBe(0);
    } finally {
      child.kill();
    }
  }

  await deliver(refund);

  expect((await rt.queries.byKey(refund.idempotencyKey))!.status).toBe('PENDING_REFERENCE');

  await deliver(bet);

  const restarted = childHarness('references');

  try {
    await restarted.wait('ready');
    restarted.send({ type: 'execute' });
    await restarted.wait('done');

    expect(await restarted.child.exited).toBe(0);
  } finally {
    restarted.kill();
  }

  expect((await rt.queries.byKey(refund.idempotencyKey))!.status).toBe('PROCESSED');

  const recon = await rt.queries.reconciliation(bet.walletId);

  expect(recon.consistent).toBe(true);
  expect(recon.storedBalance.amount).toBe('100.00');
  expect(recon.checkedEntries).toBe(3);
});

test('publisher process dies after SQS send; expired lease republishes the same event identity', async () => {
  // Drain events already asserted by the previous publisher scenario, preserving the actual request queue.
  for (let i = 0; i < 100; i++) {
    const response = await rt.client.send(
      new ReceiveMessageCommand({
        QueueUrl: rt.queues.events,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );

    if (!response.Messages?.length) break;

    await Promise.all(
      response.Messages.map((m) =>
        rt.client.send(
          new DeleteMessageCommand({ QueueUrl: rt.queues.events, ReceiptHandle: m.ReceiptHandle! }),
        ),
      ),
    );
  }

  const c = await command();

  await rt.service.process(c, { correlationId: newId() });

  const child = childHarness('crash-publisher');
  let eventId: string;

  try {
    await child.wait('ready');
    child.send({ type: 'execute' });
    eventId = (await child.wait('published')).eventId!;

    expect(await child.child.exited).toBe(92);
  } finally {
    child.kill();
  }

  const event = await rt.db.em
    .fork()
    .execute<{ published_at: Date | null; payload: { eventId: string } }[]>(
      'SELECT published_at,payload FROM outbox WHERE id=?',
      [eventId!],
    );

  expect(event[0]!.published_at).toBeNull();
  expect(event[0]!.payload.eventId).toBe(eventId!);

  await rt.db.em
    .fork()
    .execute(
      "UPDATE outbox SET lease_until=now()-interval '1 second' WHERE published_at IS NULL AND lease_until IS NOT NULL",
    );

  for (let i = 0; i < 20; i++) {
    if ((await rt.workers.publishOnce()) === 0) break;
  }

  const confirmed = await rt.db.em
    .fork()
    .execute<{ published_at: Date | null }[]>('SELECT published_at FROM outbox WHERE id=?', [
      eventId!,
    ]);

  expect(confirmed[0]!.published_at).not.toBeNull();

  let delivered = false;

  for (let i = 0; i < 30; i++) {
    const response = await rt.client.send(
      new ReceiveMessageCommand({
        QueueUrl: rt.queues.events,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );

    if (!response.Messages?.length) break;

    for (const m of response.Messages) {
      if (object(JSON.parse(m.Body!) as unknown).eventId === eventId!) delivered = true;

      await rt.client.send(
        new DeleteMessageCommand({ QueueUrl: rt.queues.events, ReceiptHandle: m.ReceiptHandle! }),
      );
    }
  }

  expect(delivered).toBe(true);
  expect((await rt.queries.reconciliation(c.walletId)).consistent).toBe(true);
});
