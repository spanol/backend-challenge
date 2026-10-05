import 'reflect-metadata';
import { Counter, Gauge } from 'prom-client';
import { requireTestIsolation } from '../tests/helpers/isolated-environment';
import { createRuntime } from '../src/infrastructure/runtime';
import { createHttpApp } from '../src/adapters/http';
import { Workers } from '../src/infrastructure/messaging/workers';
import { initializeTracing } from '../src/infrastructure/tracing';

const resourceId = requireTestIsolation();
initializeTracing();
const rt = await createRuntime();
const inflight = new Gauge({
  name: 'load_wager_inflight',
  help: 'Harness financial operations still running, including disconnected HTTP clients',
  registers: [rt.metrics.registry],
});
const processWager = rt.service.process.bind(rt.service);
rt.service.process = async (...args: Parameters<typeof rt.service.process>) => {
  inflight.inc();
  try {
    return await processWager(...args);
  } finally {
    inflight.dec();
  }
};
const accepted = new Counter({
  name: 'load_outbox_accepted_total',
  help: 'Test harness callbacks after SQS accepts an outbox event, before SQL acknowledgement',
  registers: [rt.metrics.registry],
});
rt.workers = new Workers(rt.db, rt.client, rt.queues, rt.service, rt.metrics, {
  afterPublish: () => {
    accepted.inc();
  },
});
const app = await createHttpApp(rt);
await app.listen(3000, '0.0.0.0');
const sessions = await rt.db.em.fork().execute<{ pid: number }[]>('SELECT pg_backend_pid() pid');
console.log(
  JSON.stringify({
    event: 'distributed_replica_ready',
    instance: process.env.LOAD_INSTANCE,
    resourceId,
    pid: process.pid,
    backendPid: sessions[0]!.pid,
  }),
);
rt.workers.start();
