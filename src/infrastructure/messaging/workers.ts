import { createHash } from 'node:crypto';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  newId,
  object,
  parseCommand,
  payloadHash,
  identifier,
  RequestError,
  PermanentInfrastructureError,
} from '../../application/contracts';
import type { FaultHooks } from '../../application/types/execution';
import type { WageringService } from '../../application/wagering';
import { ApplicationErrorCode, IdentifierField } from '../../application/constants/errors';
import { HttpStatusCode } from '../../application/constants/http-status';
import { FinancialErrorCode, type WagerFailureCode } from '../../domain/constants/errors';
import { WagerMessageType } from '../../domain/constants/messages';
import { WagerStatus } from '../../domain/constants/wager';
import { retryDelay } from '../../domain/messages';
import type { Database } from '../persistence/types/database';
import { WageringQueries } from '../persistence/queries';
import { log, errorCode, Observability } from '../observability';
import { LogEvent } from '../constants/log-events';
import { withSpan } from '../tracing';
import { ConsumerName, MessageGroup, WorkerSource } from './constants';
import type { Queues } from './types/sqs';
import type { ClaimedEvent, ClaimedReference, DownstreamEffect } from './types/workers';

const terminalFailureCodes = new Set<string>([
  FinancialErrorCode.RETRY_EXHAUSTED,
  FinancialErrorCode.PERMANENT_INFRASTRUCTURE_FAILURE,
]);

function isTerminalFailureCode(code: string): code is WagerFailureCode {
  return terminalFailureCodes.has(code);
}

export class Workers {
  private stopped = false;
  private tasks: Promise<void>[] = [];
  private readonly activeReceipts = new Set<string>();
  private readonly visibility = Number(process.env.SQS_VISIBILITY_SECONDS ?? 30);

  constructor(
    private readonly db: Database,
    private readonly client: SQSClient,
    readonly queues: Queues,
    private readonly service: WageringService,
    readonly metrics = new Observability(),
    private readonly hooks: FaultHooks = {},
  ) {}

  start(): void {
    this.stopped = false;
    this.tasks = [
      this.loop(WorkerSource.SQS, () => this.consumeOnce(), 20),
      this.loop(WorkerSource.OUTBOX, () => this.publishOnce(), 100),
      this.loop(
        WorkerSource.REFERENCES,
        () => this.referencesOnce(),
        Number(process.env.REFERENCE_INTERVAL_MS ?? 250),
      ),
      this.loop(WorkerSource.TELEMETRY, () => this.telemetry(), 2000),
      this.loop(WorkerSource.DLQ_AUDIT, () => this.auditDlqOnce(), 2000),
    ];
  }

  private async loop(
    source: string,
    work: () => Promise<unknown>,
    interval: number,
  ): Promise<void> {
    while (!this.stopped) {
      try {
        await work();
      } catch (error) {
        this.metrics.retries.inc({ source });
        log(LogEvent.WORKER_RETRY, { source, errorCode: errorCode(error) });
      }

      if (!this.stopped) await Bun.sleep(interval);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;

    let deadline!: ReturnType<typeof setTimeout>;

    await Promise.race([
      Promise.allSettled(this.tasks),
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, 25000);
      }),
    ]);
    clearTimeout(deadline);
    // Any receipt remaining after failed processing is returned immediately, rather than waiting for the full visibility timeout.
    await Promise.allSettled(
      [...this.activeReceipts].map((ReceiptHandle) =>
        this.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queues.requests,
            ReceiptHandle,
            VisibilityTimeout: 0,
          }),
        ),
      ),
    );
    this.activeReceipts.clear();
  }

  async consumeOnce(): Promise<number> {
    if (this.stopped) return 0;

    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queues.requests,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
        VisibilityTimeout: this.visibility,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );

    const messages = response.Messages ?? [];

    if (this.stopped) {
      await Promise.allSettled(
        messages.map((message) =>
          this.client
            .send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: this.queues.requests,
                ReceiptHandle: message.ReceiptHandle!,
                VisibilityTimeout: 0,
              }),
            )
            .catch((error) =>
              log(LogEvent.VISIBILITY_RELEASE_FAILED, {
                messageId: message.MessageId,
                errorCode: errorCode(error),
              }),
            ),
        ),
      );

      return 0;
    }

    for (const message of messages) await this.handle(message);

    return messages.length;
  }

  private async handle(message: Message): Promise<void> {
    const receipt = message.ReceiptHandle!;

    this.activeReceipts.add(receipt);

    const heartbeat = setInterval(
      () => {
        void this.client
          .send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: this.queues.requests,
              ReceiptHandle: receipt,
              VisibilityTimeout: this.visibility,
            }),
          )
          .catch((error) =>
            log(LogEvent.VISIBILITY_EXTENSION_FAILED, {
              messageId: message.MessageId,
              errorCode: errorCode(error),
            }),
          );
      },
      Math.max(1000, this.visibility * 500),
    );

    const timer = this.metrics.latency.startTimer({ transport: 'sqs' });
    let businessMessageId = message.MessageId!;
    let key: string | undefined;

    try {
      let body: Record<string, unknown>;

      try {
        body = object(JSON.parse(message.Body ?? ''));
      } catch {
        throw new RequestError(
          HttpStatusCode.BAD_REQUEST,
          ApplicationErrorCode.INVALID_MESSAGE_JSON,
        );
      }

      if (
        body.type !== WagerMessageType.TRANSACTION_REQUESTED ||
        typeof body.occurredAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T/.test(body.occurredAt) ||
        Number.isNaN(Date.parse(body.occurredAt))
      )
        throw new RequestError(
          HttpStatusCode.BAD_REQUEST,
          ApplicationErrorCode.INVALID_MESSAGE_ENVELOPE,
        );

      businessMessageId = identifier(body.messageId, IdentifierField.MESSAGE);

      const data = object(body.data);
      const command = parseCommand(data, data.idempotencyKey);

      key = command.idempotencyKey;

      const result = await withSpan(
        'wager.process',
        {
          'wager.transport': 'sqs',
          'wager.kind': command.kind,
          'wager.message_id': businessMessageId,
        },
        async (span) => {
          const processed = await this.service.process(command, {
            correlationId: businessMessageId,
            messageId: businessMessageId,
            consumerName: ConsumerName.WAGER_TRANSACTIONS,
          });

          span.setAttributes({
            'wager.status': processed.status,
            'wager.idempotent_replay': processed.idempotentReplay,
          });

          return processed;
        },
      );

      if (result.idempotentReplay) this.metrics.duplicates.inc();
      else this.metrics.transactions.inc({ status: result.status });

      log(LogEvent.WAGER_COMMITTED, {
        correlationId: businessMessageId,
        messageId: businessMessageId,
        transactionId: result.transactionId,
        walletId: command.walletId,
        providerId: command.providerId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      });
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: this.queues.requests, ReceiptHandle: receipt }),
      );
      this.activeReceipts.delete(receipt);
    } catch (error) {
      if (error instanceof RequestError || error instanceof PermanentInfrastructureError) {
        if (key && error instanceof PermanentInfrastructureError) {
          const accepted = await new WageringQueries(this.db).byKey(key);

          if (accepted)
            await this.service.failAccepted(accepted.id, key, {
              correlationId: businessMessageId,
              messageId: businessMessageId,
            });
        }

        const code =
          error instanceof RequestError
            ? error.code
            : FinancialErrorCode.PERMANENT_INFRASTRUCTURE_FAILURE;

        await this.auditFailure(businessMessageId, message.Body ?? '', code);
        await this.client.send(
          new SendMessageCommand({
            QueueUrl: this.queues.dlq,
            MessageBody: message.Body ?? '{}',
            MessageGroupId: MessageGroup.INVALID_MESSAGES,
            MessageDeduplicationId: createHash('sha256').update(message.MessageId!).digest('hex'),
            MessageAttributes: {
              failureCode: { DataType: 'String', StringValue: code },
              originalMessageId: { DataType: 'String', StringValue: businessMessageId },
            },
          }),
        );
        this.metrics.dlq.inc();
        await this.client.send(
          new DeleteMessageCommand({ QueueUrl: this.queues.requests, ReceiptHandle: receipt }),
        );
        this.activeReceipts.delete(receipt);
        log(LogEvent.MESSAGE_DEAD_LETTERED, {
          messageId: businessMessageId,
          correlationId: businessMessageId,
          errorCode: code,
        });
      } else {
        this.metrics.retries.inc({ source: WorkerSource.SQS });
        log(LogEvent.MESSAGE_RETRY, {
          messageId: businessMessageId,
          correlationId: businessMessageId,
          errorCode: errorCode(error),
        });
        // Do not acknowledge; queue redrive policy limits attempts even during total database unavailability.
      }
    } finally {
      clearInterval(heartbeat);
      timer();

      if (this.stopped && this.activeReceipts.has(receipt))
        await this.client
          .send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: this.queues.requests,
              ReceiptHandle: receipt,
              VisibilityTimeout: 0,
            }),
          )
          .catch(() => undefined);

      this.activeReceipts.delete(receipt);
    }
  }

  async auditFailure(messageId: string, body: string, code: string): Promise<void> {
    await this.db.em
      .fork()
      .execute(
        'INSERT INTO failed_deliveries(message_id,payload_hash,failure_code) VALUES (?,?,?) ON CONFLICT DO NOTHING',
        [messageId, createHash('sha256').update(body).digest('hex'), code],
      );
  }

  async auditDlqOnce(): Promise<number> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queues.dlq,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 5,
        MessageAttributeNames: ['All'],
      }),
    );

    for (const message of response.Messages ?? []) {
      let messageId =
        message.MessageAttributes?.originalMessageId?.StringValue ?? message.MessageId!;
      const code =
        message.MessageAttributes?.failureCode?.StringValue ?? FinancialErrorCode.RETRY_EXHAUSTED;

      try {
        const body = object(JSON.parse(message.Body ?? ''));

        messageId = identifier(body.messageId, IdentifierField.MESSAGE);

        const data = object(body.data);
        const command = parseCommand(data, data.idempotencyKey);
        const accepted = await new WageringQueries(this.db).byKey(command.idempotencyKey);

        if (
          accepted &&
          accepted.payloadHash === payloadHash(command) &&
          isTerminalFailureCode(code)
        )
          await this.service.failAccepted(
            accepted.id,
            command.idempotencyKey,
            { correlationId: messageId, messageId },
            code,
          );
      } catch (error) {
        if (!(error instanceof RequestError) && !(error instanceof SyntaxError)) throw error;
      }

      await this.auditFailure(messageId, message.Body ?? '', code);
      // Retain dead letters for deliberate inspection/redrive; auditing does not discard the delivery.
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queues.dlq,
          ReceiptHandle: message.ReceiptHandle!,
          VisibilityTimeout: 0,
        }),
      );
    }

    return response.Messages?.length ?? 0;
  }

  async publishOnce(): Promise<number> {
    const token = newId();
    const leaseMs = Number(process.env.OUTBOX_LEASE_MS ?? 30000);

    const rows = await this.db.em.fork().transactional(async (em) =>
      em.execute<ClaimedEvent[]>(
        `
      WITH claim AS (SELECT id FROM outbox WHERE published_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY occurred_at,id LIMIT 10 FOR UPDATE SKIP LOCKED)
      UPDATE outbox o SET lease_token=?,lease_until=now()+(? * interval '1 millisecond') FROM claim WHERE o.id=claim.id RETURNING o.id,o.aggregate_id,o.payload,o.attempts`,
        [token, leaseMs],
      ),
    );

    for (const event of rows) {
      if (this.stopped) break;

      try {
        await this.client.send(
          new SendMessageCommand({
            QueueUrl: this.queues.events,
            MessageBody: JSON.stringify(event.payload),
            MessageGroupId: event.aggregate_id,
            MessageDeduplicationId: event.id,
          }),
        );
        await this.hooks.afterPublish?.(event.id);
        await this.db.em
          .fork()
          .execute(
            'UPDATE outbox SET published_at=now(),lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND published_at IS NULL',
            [event.id, token],
          );
      } catch (error) {
        await this.db.em
          .fork()
          .execute(
            'UPDATE outbox SET attempts=attempts+1,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND published_at IS NULL',
            [new Date(Date.now() + retryDelay(event.attempts + 1)), event.id, token],
          );
        this.metrics.retries.inc({ source: WorkerSource.OUTBOX });
        log(LogEvent.OUTBOX_PUBLISH_RETRY, { eventId: event.id, errorCode: errorCode(error) });
      }
    }

    return rows.length;
  }

  async referencesOnce(): Promise<number> {
    const token = newId();

    const rows = await this.db.em.fork().transactional(async (em) =>
      em.execute<ClaimedReference[]>(
        `
      WITH claim AS (SELECT id FROM wager_transactions WHERE status='${WagerStatus.PENDING_REFERENCE}' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at,id LIMIT 10 FOR UPDATE SKIP LOCKED)
      UPDATE wager_transactions t SET lease_token=?,lease_until=now()+interval '30 seconds' FROM claim WHERE t.id=claim.id AND t.status='${WagerStatus.PENDING_REFERENCE}' RETURNING t.id,t.idempotency_key`,
        [token],
      ),
    );

    for (const row of rows) {
      if (this.stopped) break;

      this.metrics.retries.inc({ source: WorkerSource.REFERENCES });
      await this.service.retryReference(
        row.id,
        row.idempotency_key,
        { correlationId: row.id },
        token,
      );

      const completed = await new WageringQueries(this.db).transaction(row.id);

      if (
        [WagerStatus.PROCESSED, WagerStatus.REJECTED, WagerStatus.FAILED].includes(completed.status)
      )
        this.metrics.transactions.inc({ status: completed.status });
    }

    return rows.length;
  }

  private async telemetry(): Promise<void> {
    const rows = await this.db.em
      .fork()
      .execute<{ age: string; pending: string }[]>(
        'SELECT COALESCE(EXTRACT(EPOCH FROM now()-min(occurred_at)),0)::text age, count(*)::text pending FROM outbox WHERE published_at IS NULL',
      );

    this.metrics.outboxLag.set(Math.max(0, Number(rows[0]!.age)));
    this.metrics.outboxPending.set(Number(rows[0]!.pending));

    const [attrs, requests] = await Promise.all([
      this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queues.dlq,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      ),
      this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queues.requests,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed',
          ],
        }),
      ),
    ]);

    this.metrics.dlqDepth.set(Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0));
    this.metrics.requestQueueVisible.set(
      Number(requests.Attributes?.ApproximateNumberOfMessages ?? 0),
    );
    this.metrics.requestQueueInflight.set(
      Number(requests.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
    );
    this.metrics.requestQueueDelayed.set(
      Number(requests.Attributes?.ApproximateNumberOfMessagesDelayed ?? 0),
    );
  }
}

/** Downstream consumers use this durable receipt in the same transaction as their own projection/effect. */
export async function consumeEventOnce(
  db: Database,
  consumer: string,
  eventId: string,
  effect: DownstreamEffect,
): Promise<boolean> {
  return db.em.fork().transactional(async (em) => {
    const rows = await em.execute<{ event_id: string }[]>(
      'INSERT INTO event_receipts(consumer_name,event_id) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING event_id',
      [consumer, eventId],
    );

    if (!rows.length) return false;

    await effect(em);

    return true;
  });
}
