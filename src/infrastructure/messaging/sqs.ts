import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { Queues } from './types/sqs';

export function sqsClient(): SQSClient {
  return new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  });
}

function queueNames() {
  const prefix = process.env.QUEUE_PREFIX ?? '';

  return {
    requests: `${prefix}wager-transactions.fifo`,
    dlq: `${prefix}wager-transactions-dlq.fifo`,
    events: `${prefix}wager-events.fifo`,
  };
}

export async function resolveQueues(client: SQSClient): Promise<Queues> {
  const urls = await Promise.all(
    Object.values(queueNames()).map((QueueName) =>
      client.send(new GetQueueUrlCommand({ QueueName })),
    ),
  );

  return { requests: urls[0]!.QueueUrl!, dlq: urls[1]!.QueueUrl!, events: urls[2]!.QueueUrl! };
}

export async function initializeQueues(client: SQSClient): Promise<Queues> {
  const names = queueNames();

  const dlq = await client.send(
    new CreateQueueCommand({
      QueueName: names.dlq,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
        MessageRetentionPeriod: '1209600',
      },
    }),
  );

  const attributes = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl!, AttributeNames: ['QueueArn'] }),
  );

  const request = await client.send(
    new CreateQueueCommand({
      QueueName: names.requests,
      Attributes: {
        FifoQueue: 'true',
        ContentBasedDeduplication: 'false',
        VisibilityTimeout: '30',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: attributes.Attributes!.QueueArn!,
          maxReceiveCount: '5',
        }),
      },
    }),
  );

  // Explicitly update policy too: queue creation is idempotent, and startup must retain a bounded retry policy.
  await client.send(
    new SetQueueAttributesCommand({
      QueueUrl: request.QueueUrl!,
      Attributes: {
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: attributes.Attributes!.QueueArn!,
          maxReceiveCount: '5',
        }),
      },
    }),
  );

  const events = await client.send(
    new CreateQueueCommand({
      QueueName: names.events,
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
    }),
  );

  return { requests: request.QueueUrl!, dlq: dlq.QueueUrl!, events: events.QueueUrl! };
}
