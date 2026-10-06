import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { Money } from '../../src/domain/money';
import { FinancialErrorCode } from '../../src/domain/constants/errors';
import { WagerKind, WagerStatus } from '../../src/domain/constants/wager';
import { newId, object, parseCommand } from '../../src/application/contracts';
import { childHarness } from '../helpers/process-harness';
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

async function command(amount = '25.00') {
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

    expect(results.map((r) => r.status).sort()).toEqual([
      WagerStatus.PROCESSED,
      WagerStatus.REJECTED,
    ]);
    expect(done[2]!.results![0]!.status).toBe(WagerStatus.PROCESSED);

    const recon = await rt.queries.reconciliation(c.walletId);

    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance.amount).toBe('20.00');
    expect(recon.checkedEntries).toBe(2);
    expect(await Promise.all(children.map((child) => child.child.exited))).toEqual([0, 0, 0]);
  } finally {
    children.forEach((child) => child.kill());
  }
});

test('REFUND and ROLLBACK racing across processes reverse one BET only once', async () => {
  const bet = await command();

  await rt.service.process(bet, { correlationId: newId() });

  const reversals = (['REFUND', 'ROLLBACK'] as const).map((kind) =>
    parseCommand(
      {
        walletId: bet.walletId,
        playerId: bet.playerId,
        providerId: bet.providerId,
        externalTransactionId: newId(),
        roundId: bet.roundId,
        gameId: bet.gameId,
        kind,
        money: bet.money,
        referenceExternalTransactionId: bet.externalTransactionId,
      },
      newId(),
    ),
  );
  const children = Array.from({ length: 2 }, () => childHarness('financial'));

  try {
    const ready = await Promise.all(children.map((child) => child.wait('ready')));

    expect(new Set(ready.map((item) => item.pid)).size).toBe(2);
    expect(new Set(ready.map((item) => item.backendPid)).size).toBe(2);
    children.forEach((child, index) =>
      child.send({ type: 'prepare', config: { commands: [reversals[index]!] } }),
    );
    await Promise.all(children.map((child) => child.wait('armed')));
    children.forEach((child) => child.send({ type: 'execute' }));

    const results = (await Promise.all(children.map((child) => child.wait('done')))).map(
      (done) => done.results![0]!,
    );

    expect(results.map((result) => result.status).sort()).toEqual([
      WagerStatus.PROCESSED,
      WagerStatus.REJECTED,
    ]);
    expect(results.find((result) => result.status === WagerStatus.REJECTED)!.failureCode).toBe(
      FinancialErrorCode.REFERENCE_ALREADY_REVERSED,
    );
    expect((await rt.queries.reconciliation(bet.walletId)).storedBalance.amount).toBe('100.00');
    expect((await rt.queries.reconciliation(bet.walletId)).checkedEntries).toBe(3);
    expect(await Promise.all(children.map((child) => child.child.exited))).toEqual([0, 0]);
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

    expect(completed.results![0]!.status).toBe(WagerStatus.PROCESSED);
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

    expect(row!.status).toBe(WagerStatus.PROCESSED);

    // The consumer never starts a publisher: the operation's events exist after the commit,
    // before their first send. A different process will publish these exact identities.
    const durable = await rt.db.em
      .fork()
      .execute<{ id: string; published_at: Date | null; event_type: string }[]>(
        "SELECT id,published_at,event_type FROM outbox WHERE payload->'data'->>'transactionId'=? ORDER BY event_type",
        [row!.id],
      );

    expect(durable.map((e) => e.event_type)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(durable.every((e) => e.published_at === null)).toBe(true);

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

    const afterReplay = await rt.db.em
      .fork()
      .execute<{ id: string }[]>(
        "SELECT id FROM outbox WHERE payload->'data'->>'transactionId'=? ORDER BY event_type",
        [row!.id],
      );

    expect(afterReplay.map((e) => e.id)).toEqual(durable.map((e) => e.id));

    const publisher = childHarness('publisher');

    try {
      await publisher.wait('ready');
      publisher.send({ type: 'execute' });
      await publisher.wait('done');
      expect(await publisher.child.exited).toBe(0);
    } finally {
      publisher.kill();
    }

    const recovered = await rt.db.em
      .fork()
      .execute<{ id: string; published_at: Date | null }[]>(
        "SELECT id,published_at FROM outbox WHERE payload->'data'->>'transactionId'=? ORDER BY event_type",
        [row!.id],
      );

    expect(recovered.map((e) => e.id)).toEqual(durable.map((e) => e.id));
    expect(recovered.every((e) => e.published_at !== null)).toBe(true);
  } finally {
    child.kill();
  }
});

test('two OS publisher processes claim different batches and publish all durable events', async () => {
  const future = await command();

  await rt.service.process(future, { correlationId: newId() });
  await rt.db.em
    .fork()
    .execute("UPDATE outbox SET next_attempt_at=now()+interval '1 day' WHERE aggregate_id=?", [
      future.walletId,
    ]);

  const futureEvents = await rt.db.em
    .fork()
    .execute<{ id: string }[]>('SELECT id FROM outbox WHERE aggregate_id=? ORDER BY id', [
      future.walletId,
    ]);
  const dueWallets: string[] = [];

  // Ensure enough events for both publishers, regardless of earlier scenario ordering.
  for (let i = 0; i < 12; i++) {
    const c = await command();

    await rt.service.process(c, { correlationId: newId() });
    dueWallets.push(c.walletId);
  }

  const children = [childHarness('publisher'), childHarness('publisher')];

  try {
    await Promise.all(children.map((child) => child.wait('ready')));
    children.forEach((child) => child.send({ type: 'prepare', config: { hold: true } }));
    await Promise.all(children.map((child) => child.wait('armed')));
    children.forEach((child) => child.send({ type: 'execute' }));
    const published = await Promise.all(children.map((child) => child.wait('published')));

    expect(new Set(published.map((event) => event.eventId)).size).toBe(2);
    children.forEach((child) => child.send({ type: 'release' }));

    const done = await Promise.all(children.map((child) => child.wait('done')));

    expect(done.every((r) => r.total! > 0)).toBe(true);

    expect(await Promise.all(children.map((child) => child.child.exited))).toEqual([0, 0]);

    const rows = await rt.db.em
      .fork()
      .execute<{ count: string }[]>(
        'SELECT count(*)::text count FROM outbox WHERE aggregate_id=ANY(?::uuid[]) AND published_at IS NULL',
        [`{${dueWallets.join(',')}}`],
      );

    expect(rows[0]!.count).toBe('0');

    const unchangedFuture = await rt.db.em
      .fork()
      .execute<{ id: string }[]>(
        'SELECT id FROM outbox WHERE aggregate_id=? AND published_at IS NULL AND lease_token IS NULL AND attempts=0 ORDER BY id',
        [future.walletId],
      );

    expect(unchangedFuture).toEqual(futureEvents);
  } finally {
    children.forEach((child) => child.kill());
  }
});

test('reference-before-parent is acknowledged and resumed by a newly started worker process', async () => {
  const bet = await command();

  const refund = {
    ...bet,
    kind: WagerKind.REFUND as const,
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

  expect((await rt.queries.byKey(refund.idempotencyKey))!.status).toBe(
    WagerStatus.PENDING_REFERENCE,
  );

  await deliver(bet);

  // Respect the persisted retry schedule instead of relying on child startup time.
  const [schedule] = await rt.db.em
    .fork()
    .execute<{ wait_ms: string }[]>(
      'SELECT GREATEST(0,EXTRACT(EPOCH FROM next_attempt_at-now())*1000)::text wait_ms FROM wager_transactions WHERE idempotency_key=?',
      [refund.idempotencyKey],
    );

  await Bun.sleep(Math.ceil(Number(schedule!.wait_ms)) + 1);

  const restarted = childHarness('references');

  try {
    await restarted.wait('ready');
    restarted.send({ type: 'execute' });
    await restarted.wait('done');

    expect(await restarted.child.exited).toBe(0);
  } finally {
    restarted.kill();
  }

  expect((await rt.queries.byKey(refund.idempotencyKey))!.status).toBe(WagerStatus.PROCESSED);

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

// Windows terminates child processes instead of delivering POSIX SIGTERM. The Docker/Linux gate runs this proof.
test.skipIf(process.platform === 'win32')(
  'real SIGTERM drains an active SQS commit, ACKs it and leaves subsequent work for another process',
  async () => {
    const first = await command();
    const next = await command();
    const messageId = newId();

    async function deliver(c: typeof first, id: string) {
      await rt.client.send(
        new SendMessageCommand({
          QueueUrl: rt.queues.requests,
          MessageBody: JSON.stringify({
            messageId: id,
            type: 'WagerTransactionRequested',
            occurredAt: new Date().toISOString(),
            data: c,
          }),
          MessageGroupId: c.walletId,
          MessageDeduplicationId: newId(),
        }),
      );
    }

    await deliver(first, messageId);

    const child = childHarness(
      'shutdown',
      new URL('../fixtures/shutdown-child.ts', import.meta.url),
    );

    try {
      const ready = await child.wait('ready');

      child.send({ type: 'execute' });
      await child.wait('commit-entered');
      expect(await rt.queries.byKey(first.idempotencyKey)).toBeNull();

      process.kill(ready.pid!, 'SIGTERM');
      await child.wait('signal-received');
      await deliver(next, newId());

      // Cross the original one-second visibility deadline while the real
      // heartbeat keeps the active receipt valid during shutdown.
      await Bun.sleep(1600);
      expect(await rt.queries.byKey(first.idempotencyKey)).toBeNull();

      expect(child.events.some((event) => event.type === 'committed')).toBe(false);

      child.send({ type: 'release' });
      await child.wait('committed');
      expect(await child.child.exited).toBe(143);
      expect((await rt.queries.byKey(first.idempotencyKey))!.status).toBe(WagerStatus.PROCESSED);
      expect(await rt.queries.byKey(next.idempotencyKey)).toBeNull();

      // Only the message queued after shutdown remains: the active one was ACKed after committing.
      expect(await rt.workers.consumeOnce()).toBe(1);
      expect((await rt.queries.byKey(next.idempotencyKey))!.status).toBe(WagerStatus.PROCESSED);
      expect(await rt.workers.consumeOnce()).toBe(0);

      await deliver(first, messageId);
      expect(await rt.workers.consumeOnce()).toBe(1);

      const inbox = await rt.db.em
        .fork()
        .execute<{ count: string }[]>(
          'SELECT count(*)::text count FROM inbox WHERE consumer_name=? AND message_id=?',
          ['wager-transactions', messageId],
        );
      const events = await rt.db.em
        .fork()
        .execute<{ count: string }[]>(
          "SELECT count(*)::text count FROM outbox WHERE payload->'data'->>'transactionId'=?",
          [(await rt.queries.byKey(first.idempotencyKey))!.id],
        );

      expect(inbox[0]!.count).toBe('1');
      expect(events[0]!.count).toBe('2');
      for (const c of [first, next]) {
        const recon = await rt.queries.reconciliation(c.walletId);

        expect(recon.storedBalance.amount).toBe('75.00');
        expect(recon.checkedEntries).toBe(2);
      }
    } finally {
      child.kill();
    }
  },
);
