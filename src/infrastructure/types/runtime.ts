import type { SQSClient } from '@aws-sdk/client-sqs';
import type { WageringService } from '../../application/wagering';
import type { Database } from '../persistence/types/database';
import type { WageringQueries } from '../persistence/queries';
import type { Observability } from '../observability';
import type { Queues } from '../messaging/types/sqs';
import type { Workers } from '../messaging/workers';

export interface Runtime {
  db: Database;
  client: SQSClient;
  queues: Queues;
  service: WageringService;
  queries: WageringQueries;
  workers: Workers;
  metrics: Observability;
}
