import 'reflect-metadata';
import { createHttpApp } from './adapters/http';
import { createRuntime } from './infrastructure/runtime';
import { errorCode, log } from './infrastructure/observability';
import { LogEvent } from './infrastructure/constants/log-events';
import { initializeTracing, shutdownTracing } from './infrastructure/tracing';

let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;

try {
  initializeTracing();
  runtime = await createRuntime();
  log(LogEvent.INFRASTRUCTURE_READY);

  const app = await createHttpApp(runtime);

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');

  if (process.env.WORKERS_ENABLED !== 'false') runtime.workers.start();

  log(LogEvent.APPLICATION_STARTED, { port: Number(process.env.PORT ?? 3000) });
} catch (error) {
  log(LogEvent.STARTUP_FAILED, { errorCode: errorCode(error) });

  if (runtime) {
    await runtime.workers.stop();
    await runtime.db.close(true);
    runtime.client.destroy();
  }

  await shutdownTracing();
  process.exitCode = 1;
}
