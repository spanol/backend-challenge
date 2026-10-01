import { createRuntime } from '../../src/infrastructure/runtime';
import { WageringService } from '../../src/application/wagering';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { Workers } from '../../src/infrastructure/messaging/workers';
import { newId } from '../../src/application/contracts';
import type { FaultHooks } from '../../src/application/types/execution';
import type { ChildConfig, ChildControl } from './types/process';
import { requireTestIsolation } from './isolated-environment';

requireTestIsolation();

const mode = Bun.argv[2]!;
let config: ChildConfig = {};
let execute!: () => void;
let release!: () => void;

const start = new Promise<void>((resolve) => {
  execute = resolve;
});

const released = new Promise<void>((resolve) => {
  release = resolve;
});

process.on('disconnect', () => process.exit(99));
process.on('message', (message: ChildControl) => {
  if (message.type === 'prepare') {
    config = message.config ?? {};
    process.send?.({ type: 'armed' });
  }
  if (message.type === 'execute') execute();
  if (message.type === 'release') release();
});

const rt = await createRuntime();
const pids = await rt.db.em.fork().execute<{ pid: number }[]>('SELECT pg_backend_pid() pid');

process.send?.({ type: 'ready', pid: process.pid, backendPid: pids[0]!.pid });
await start;
process.send?.({ type: 'started', at: Date.now() });

try {
  let delayedFirstCommit = false;

  const hooks: FaultHooks = {
    beforeCommit: async () => {
      if (config.hold) {
        process.send?.({ type: 'commit-entered' });
        await released;
      } else if (mode === 'financial' && !delayedFirstCommit) {
        // Keep the first commit open to prove overlap without slowing every idempotent replay.
        delayedFirstCommit = true;
        await Bun.sleep(200);
      }
    },
    afterCommit: () => {
      if (mode === 'crash-consumer') {
        process.send?.({ type: 'committed' });
        process.exit(91);
      }
    },
  };

  const service = new WageringService(new MikroFinancialUnitOfWork(rt.db), undefined, hooks);

  const workers = new Workers(rt.db, rt.client, rt.queues, service, undefined, {
    afterPublish: async (eventId) => {
      process.send?.({ type: 'published', eventId });

      if (mode === 'crash-publisher') process.exit(92);
      if (config.hold) await released;
    },
  });

  if (mode === 'financial') {
    const results = await Promise.all(
      (config.commands ?? []).map((command) =>
        service.process(command, { correlationId: newId() }),
      ),
    );

    process.send?.({ type: 'done', results, at: Date.now() });
  } else if (mode === 'crash-consumer') {
    await workers.consumeOnce();

    throw new Error('Expected process crash after commit');
  } else if (mode === 'consumer' || mode === 'references') {
    const count =
      mode === 'consumer' ? await workers.consumeOnce() : await workers.referencesOnce();

    process.send?.({ type: 'done', total: count, at: Date.now() });
  } else {
    let total = 0;

    for (let i = 0; i < 100; i++) {
      const count = await workers.publishOnce();

      total += count;

      if (count === 0) break;
    }

    process.send?.({ type: 'done', total, at: Date.now() });
  }
} finally {
  await rt.db.close(true);
  rt.client.destroy();
}

process.exit(0);
