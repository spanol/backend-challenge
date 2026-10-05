import {
  ChangeMessageVisibilityCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { canonicalJson, identifier, object } from '../../application/contracts';
import { IdentifierField } from '../../application/constants/errors';
import type { FaultHooks } from '../../application/types/execution';
import type { Database } from '../persistence/types/database';
import { InfrastructureErrorCode } from '../constants/errors';
import { ConsumerName } from './constants';

/** Optional demo sink: envelopes stay in PostgreSQL, with durable delivery receipts. */
export class EventReceiptConsumer {
  private readonly activeReceipts = new Set<string>();

  constructor(
    private readonly db: Database,
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly hooks: FaultHooks = {},
    private readonly stopped = () => false,
  ) {}

  async release(): Promise<void> {
    await Promise.allSettled(
      [...this.activeReceipts].map((ReceiptHandle) =>
        this.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle,
            VisibilityTimeout: 0,
          }),
        ),
      ),
    );
    this.activeReceipts.clear();
  }

  async consumeOnce(): Promise<number> {
    if (this.stopped()) return 0;

    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 30,
      }),
    );
    const messages = response.Messages ?? [];
    for (const message of messages) this.activeReceipts.add(message.ReceiptHandle!);
    if (this.stopped()) {
      await this.release();
      return messages.length;
    }
    if (!messages.length) return 0;

    try {
      const envelopes = messages.map((message) => {
        const payload = object(JSON.parse(message.Body ?? '') as unknown);
        const eventId = identifier(payload.eventId, IdentifierField.MESSAGE, true);
        return { eventId, payload };
      });
      const ids = [...new Set(envelopes.map((event) => event.eventId))];
      const uuidArray = `{${ids.join(',')}}`;
      await this.db.em.fork().transactional(async (em) => {
        const stored = await em.execute<{ id: string; payload: unknown }[]>(
          'SELECT id,payload FROM outbox WHERE id=ANY(?::uuid[])',
          [uuidArray],
        );
        const archive = new Map(stored.map((row) => [row.id, canonicalJson(row.payload)]));
        if (envelopes.some((event) => archive.get(event.eventId) !== canonicalJson(event.payload)))
          throw new Error(InfrastructureErrorCode.EVENT_AUDIT_PAYLOAD_MISMATCH);

        await em.execute(
          'INSERT INTO event_receipts(consumer_name,event_id) SELECT ?,unnest(?::uuid[]) ON CONFLICT DO NOTHING',
          [ConsumerName.DEMO_EVENT_AUDIT, uuidArray],
        );
        await this.hooks.beforeCommit?.();
      });
      await this.hooks.afterCommit?.();
      const ack = await this.client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: messages.map((message, index) => ({
            Id: String(index),
            ReceiptHandle: message.ReceiptHandle!,
          })),
        }),
      );
      const successful = new Set((ack.Successful ?? []).map((entry) => entry.Id));
      if (ack.Failed?.length || messages.some((_, index) => !successful.has(String(index))))
        throw new Error(InfrastructureErrorCode.EVENT_AUDIT_ACK_INCOMPLETE);
      return messages.length;
    } finally {
      for (const message of messages) this.activeReceipts.delete(message.ReceiptHandle!);
    }
  }
}
