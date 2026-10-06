import { rename } from 'node:fs/promises';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { object, identifier } from '../src/application/contracts';
import { IdentifierField } from '../src/application/constants/errors';
import { connectDatabase } from '../src/infrastructure/persistence/database';
import { sqsClient, resolveQueues } from '../src/infrastructure/messaging/sqs';
import { DemoEventReplay } from '../src/infrastructure/messaging/event-replay';

if (process.env.DEMO_EVENT_AUDIT !== 'true') throw new Error('Demo audit must be enabled');
const path = process.env.EVENT_REPLAY_CHECKPOINT;
if (!path) throw new Error('EVENT_REPLAY_CHECKPOINT is required');
const db = await connectDatabase();
const client = sqsClient();
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  const queues = await resolveQueues(client);
  const replay = new DemoEventReplay(db, client, queues.events);
  const previous = await Bun.file(path).exists();
  const [last] = await db.em
    .fork()
    .execute<{ id: string }[]>('SELECT id FROM outbox ORDER BY id DESC LIMIT 1');
  const saved = previous ? object(await Bun.file(path).json()) : {};
  let cursor = identifier(
    saved.cursor ?? '00000000-0000-0000-0000-000000000000',
    IdentifierField.MESSAGE,
    true,
  );
  const upper = identifier(saved.upper ?? last?.id ?? cursor, IdentifierField.MESSAGE, true);
  const cutoffValue = saved.cutoff ?? new Date(Date.now() - 300000).toISOString();
  if (typeof cutoffValue !== 'string') throw new Error('Invalid replay cutoff');
  const cutoff = new Date(cutoffValue);
  if (Number.isNaN(cutoff.getTime())) throw new Error('Invalid replay cutoff');
  let sent = Number(saved.sent ?? 0);
  if (!Number.isSafeInteger(sent) || sent < 0) throw new Error('Invalid replay progress');
  let done = saved.done === true;
  while (!stopping && !done) {
    const attributes = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queues.events,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }),
    );
    const depth =
      Number(attributes.Attributes?.ApproximateNumberOfMessages ?? 0) +
      Number(attributes.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
    if (depth >= 10000) {
      await Bun.sleep(500);
      continue;
    }
    try {
      const page = await replay.page(cursor, upper, cutoff);
      cursor = page.cursor;
      sent += page.sent;
      done = page.done;
      await Bun.write(
        `${path}.next`,
        JSON.stringify({ cursor, upper, cutoff: cutoff.toISOString(), sent, done }),
      );
      await rename(`${path}.next`, path);
      console.log(JSON.stringify({ event: 'demo_event_replay_progress', sent, done }));
    } catch {
      console.log(JSON.stringify({ event: 'demo_event_replay_retry', sent }));
      await Bun.sleep(2000);
    }
  }
} finally {
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
  await db.close(true);
  client.destroy();
}
