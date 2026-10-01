import { WageringService } from '../application/wagering';
import { connectDatabase } from './persistence/database';
import { MikroFinancialUnitOfWork } from './persistence/unit-of-work';
import { WageringQueries } from './persistence/queries';
import { Observability, log } from './observability';
import { LogEvent } from './constants/log-events';
import { resolveQueues, sqsClient } from './messaging/sqs';
import { Workers } from './messaging/workers';
import type { Runtime } from './types/runtime';

export async function createRuntime(): Promise<Runtime> {
  const db = await connectDatabase();
  const client = sqsClient();

  try {
    const queues = await resolveQueues(client);
    const metrics = new Observability();

    const service = new WageringService(
      new MikroFinancialUnitOfWork(db, () => {
        metrics.lockConflicts.inc();
        metrics.retries.inc({ source: 'sql' });
      }),
      undefined,
      {},
      {
        ttlMs: Number(process.env.REFERENCE_TTL_MS ?? 900000),
        maxAttempts: Number(process.env.REFERENCE_MAX_ATTEMPTS ?? 20),
      },
    );

    return {
      db,
      client,
      queues,
      service,
      queries: new WageringQueries(db, (context) => {
        metrics.reconciliationDivergences.inc();
        log(LogEvent.RECONCILIATION_DIVERGENCE, context);
      }),
      workers: new Workers(db, client, queues, service, metrics),
      metrics,
    };
  } catch (error) {
    await db.close(true);
    client.destroy();

    throw error;
  }
}
