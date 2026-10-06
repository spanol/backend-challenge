import {
  ChangeMessageVisibilityCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { canonicalJson, identifier, object } from '../../application/contracts';
import { IdentifierField } from '../../application/constants/errors';
import type { FaultHooks } from '../../application/types/execution';
import type { Database } from '../persistence/types/database';
import { InfrastructureErrorCode } from '../constants/errors';
import { ConsumerName } from './constants';
import { workerSetting } from './settings';

/** Optional demo sink: envelopes stay in PostgreSQL, with durable delivery receipts. */
export class EventReceiptConsumer {
  private readonly activeReceipts = new Set<string>();
  private readonly pollBatches = workerSetting('EVENT_RECEIPT_POLL_BATCHES', 1, 1, 32);

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

    const messages: Message[] = [];
    const polls = await Promise.allSettled(
      Array.from({ length: this.pollBatches }, async () => {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1,
            VisibilityTimeout: 30,
          }),
        );
        for (const message of response.Messages ?? []) {
          this.activeReceipts.add(message.ReceiptHandle!);
          messages.push(message);
        }
      }),
    );
    const failedPoll = polls.find((result) => result.status === 'rejected');
    if (failedPoll?.status === 'rejected') {
      await this.release();
      throw failedPoll.reason;
    }
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
      const acks = await Promise.allSettled(
        Array.from({ length: Math.ceil(messages.length / 10) }, async (_, offset) => {
          const batch = messages.slice(offset * 10, offset * 10 + 10);
          const ack = await this.client.send(
            new DeleteMessageBatchCommand({
              QueueUrl: this.queueUrl,
              Entries: batch.map((message, index) => ({
                Id: String(index),
                ReceiptHandle: message.ReceiptHandle!,
              })),
            }),
          );
          const successful = new Set((ack.Successful ?? []).map((entry) => entry.Id));
          if (ack.Failed?.length || batch.some((_, index) => !successful.has(String(index))))
            throw new Error(InfrastructureErrorCode.EVENT_AUDIT_ACK_INCOMPLETE);
        }),
      );
      const failedAck = acks.find((result) => result.status === 'rejected');
      if (failedAck?.status === 'rejected') throw failedAck.reason;
      return messages.length;
    } finally {
      for (const message of messages) this.activeReceipts.delete(message.ReceiptHandle!);
    }
  }
}
