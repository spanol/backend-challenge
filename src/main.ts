import 'reflect-metadata';
import { createHttpApp } from './adapters/http';
import { createRuntime } from './infrastructure/runtime';
import { errorCode, log } from './infrastructure/observability';

let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;

try {
  runtime = await createRuntime();
  log('infrastructure_ready');

  const app = await createHttpApp(runtime);

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');

  if (process.env.WORKERS_ENABLED !== 'false') runtime.workers.start();

  log('application_started', { port: Number(process.env.PORT ?? 3000) });
} catch (error) {
  log('startup_failed', { errorCode: errorCode(error) });

  if (runtime) {
    await runtime.workers.stop();
    await runtime.db.close(true);
    runtime.client.destroy();
  }

  process.exitCode = 1;
}
