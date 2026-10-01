import { initializeQueues, sqsClient } from '../src/infrastructure/messaging/sqs';

const client = sqsClient();

try {
  await initializeQueues(client);
  console.log(JSON.stringify({ event: 'queues_initialized' }));
} finally {
  client.destroy();
}
