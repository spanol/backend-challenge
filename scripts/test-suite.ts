import { DeleteQueueCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { connectDatabase } from '../src/infrastructure/persistence/database';
import { initializeQueues, sqsClient } from '../src/infrastructure/messaging/sqs';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { runAllSuites } from './test-all';

const target = Bun.argv[2] ?? 'integration';

if (!['integration', 'concurrency', 'idp', 'distributed-load', 'all'].includes(target)) {
  throw new Error(
    'Usage: bun scripts/test-suite.ts integration|concurrency|idp|distributed-load|all',
  );
}

await mkdir('test-results', { recursive: true });

// Workers scan durable queues and references globally. Independent suites must not
// consume pending fixtures created by another suite, regardless of file ordering.
if (target === 'all') process.exit(await runAllSuites());

// Every destructive operation below targets only resources freshly created by this invocation.
const name = `wagering_test_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;

if (!/^wagering_test_[0-9]+_[a-f0-9]{8}$/.test(name)) throw new Error('Unsafe test database name');

const root = await connectDatabase(true);

const originalAdminUrl =
  process.env.DATABASE_ADMIN_URL ??
  'postgresql://wagering_owner:local-owner-only@127.0.0.1:55432/wagering';

const originalAppUrl =
  process.env.DATABASE_URL ?? 'postgresql://wagering_app:local-app-only@127.0.0.1:55432/wagering';
let created = false;
const client = sqsClient();
let activeChild: ReturnType<typeof Bun.spawn> | undefined;
let interrupted: 'SIGINT' | 'SIGTERM' | undefined;

const onInterrupt = (signal: 'SIGINT' | 'SIGTERM') => () => {
  interrupted = signal;
  activeChild?.kill(signal);
};

const onSigint = onInterrupt('SIGINT');
const onSigterm = onInterrupt('SIGTERM');

process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

try {
  await root.em.fork().execute(`CREATE DATABASE "${name}"`);
  created = true;

  const adminUrl = new URL(originalAdminUrl);

  adminUrl.pathname = `/${name}`;

  const appUrl = new URL(originalAppUrl);

  appUrl.pathname = `/${name}`;
  process.env.DATABASE_ADMIN_URL = adminUrl.toString();
  process.env.DATABASE_URL = appUrl.toString();
  process.env.QUEUE_PREFIX = `${name}-`;
  process.env.TEST_RESOURCE_ID = name;

  const isolated = await connectDatabase(true);

  try {
    await isolated.getMigrator().up();
    // Prove reversibility before test data exists, in the new isolated database.
    await isolated.getMigrator().down({ to: 0 });

    const remaining = await isolated.em
      .fork()
      .execute<{ count: string }[]>(
        "SELECT count(*)::text count FROM information_schema.tables WHERE table_schema='public' AND table_name='wallets'",
      );

    if (remaining[0]!.count !== '0') throw new Error('Migration down did not remove schema');

    await isolated.getMigrator().up();
  } finally {
    await isolated.close(true);
  }

  if (interrupted) throw new Error('Test setup interrupted');

  await initializeQueues(client);

  if (interrupted) throw new Error('Test setup interrupted');

  const command =
    target === 'distributed-load'
      ? [process.execPath, 'scripts/distributed-load.ts']
      : [
          process.execPath,
          'test',
          '--timeout',
          '180000',
          '--reporter',
          'junit',
          '--reporter-outfile',
          `test-results/${target}.junit.xml`,
          `tests/${target}`,
        ];

  activeChild = Bun.spawn(command, { env: process.env, stdout: 'inherit', stderr: 'inherit' });
  process.exitCode = await activeChild.exited;
} finally {
  // Lookup every owned name, including queues created before a partial setup failure.
  const queueCleanup = await Promise.allSettled(
    ['wager-transactions.fifo', 'wager-transactions-dlq.fifo', 'wager-events.fifo'].map(
      async (suffix) => {
        try {
          const { QueueUrl } = await client.send(
            new GetQueueUrlCommand({ QueueName: `${name}-${suffix}` }),
          );

          if (QueueUrl) await client.send(new DeleteQueueCommand({ QueueUrl }));
        } catch (error) {
          const code = error instanceof Error ? error.name : '';

          if (code !== 'QueueDoesNotExist' && code !== 'AWS.SimpleQueueService.NonExistentQueue')
            throw error;
        }
      },
    ),
  );

  const failures = queueCleanup.flatMap((result, index) =>
    result.status === 'rejected' ? [`queue-${index}`] : [],
  );

  try {
    if (created) await root.em.fork().execute(`DROP DATABASE "${name}" WITH (FORCE)`);
  } catch {
    failures.push('database');
  }

  try {
    await root.close(true);
  } finally {
    client.destroy();
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }

  await Bun.write(
    `test-results/resources-${target}.json`,
    JSON.stringify(
      {
        resourceId: name,
        suite: target,
        interrupted,
        cleanupComplete: failures.length === 0,
        failedResources: failures,
      },
      null,
      2,
    ),
  );

  if (failures.length) {
    console.error(`Isolated resource cleanup failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}
