import { SendMessageBatchCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { Database } from '../persistence/types/database';
import type { ClaimedEvent } from './types/workers';
import { ConsumerName } from './constants';

/** Operator recovery of demo deliveries lost by an ephemeral broker.
 * Reads the archive; never edits publication history or reapplies financial effects.
 * Concurrent/restarted runs may redeliver: the durable receipt remains unique.
 */
export class DemoEventReplay {
  constructor(
    private readonly db: Database,
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async page(cursor: string, upper: string, cutoff: Date) {
    const rows = await this.db.em.fork().execute<ClaimedEvent[]>(
      `SELECT o.id,o.aggregate_id,o.payload FROM outbox o
       WHERE o.id>?::uuid AND o.id<=?::uuid AND o.published_at IS NOT NULL
       AND o.published_at<? AND NOT EXISTS (
         SELECT 1 FROM event_receipts r WHERE r.consumer_name=? AND r.event_id=o.id)
       ORDER BY o.id LIMIT 200`,
      [cursor, upper, cutoff, ConsumerName.DEMO_EVENT_AUDIT],
    );
    for (let offset = 0; offset < rows.length; offset += 10) {
      const batch = rows.slice(offset, offset + 10);
      const response = await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: batch.map((event) => ({
            Id: event.id,
            MessageBody: JSON.stringify(event.payload),
            MessageGroupId: event.aggregate_id,
            MessageDeduplicationId: event.id,
          })),
        }),
      );
      const accepted = new Set(response.Successful?.map((entry) => entry.Id));
      if (response.Failed?.length || batch.some((event) => !accepted.has(event.id)))
        throw new Error('Demo event replay batch was not fully accepted');
    }
    return { cursor: rows.at(-1)?.id ?? cursor, sent: rows.length, done: rows.length === 0 };
  }
}
