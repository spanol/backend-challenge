import 'reflect-metadata';
import { createRuntime } from '../../src/infrastructure/runtime';
import { createHttpApp } from '../../src/adapters/http';
import { WageringService } from '../../src/application/wagering';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { Workers } from '../../src/infrastructure/messaging/workers';
import { requireTestIsolation } from '../helpers/isolated-environment';
import type { ChildControl } from '../helpers/types/process';

requireTestIsolation();

let release!: () => void;
const released = new Promise<void>((resolve) => {
  release = resolve;
});
const rt = await createRuntime();

rt.service = new WageringService(new MikroFinancialUnitOfWork(rt.db), undefined, {
  beforeCommit: async () => {
    process.send?.({ type: 'commit-entered' });
    await released;
  },
  afterCommit: () => {
    process.send?.({ type: 'committed' });
  },
});
rt.workers = new Workers(rt.db, rt.client, rt.queues, rt.service, rt.metrics);

// Only observation is added: the real signal is handled by createHttpApp's production lifecycle.
process.once('SIGTERM', () => {
  process.send?.({ type: 'signal-received' });
});
process.on('disconnect', () => process.exit(99));
process.on('message', (message: ChildControl) => {
  if (message.type === 'execute') rt.workers.start();
  if (message.type === 'release') release();
});

const app = await createHttpApp(rt);

await app.listen(0, '127.0.0.1');
process.send?.({ type: 'ready', pid: process.pid });
