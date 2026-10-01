import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      pid: process.pid,
      event,
      ...fields,
    }),
  );
}

export class Observability {
  readonly registry = new Registry();
  readonly transactions = new Counter({
    name: 'wager_transactions_total',
    help: 'Committed transactions by terminal or pending status',
    labelNames: ['status'],
    registers: [this.registry],
  });
  readonly duplicates = new Counter({
    name: 'wager_duplicates_total',
    help: 'Idempotent replays',
    registers: [this.registry],
  });
  readonly retries = new Counter({
    name: 'wager_retries_total',
    help: 'Infrastructure or reference retries',
    labelNames: ['source'],
    registers: [this.registry],
  });
  readonly dlq = new Counter({
    name: 'wager_dlq_total',
    help: 'Permanently invalid messages sent to DLQ',
    registers: [this.registry],
  });
  readonly dlqDepth = new Gauge({
    name: 'wager_dlq_depth',
    help: 'Messages waiting in DLQ',
    registers: [this.registry],
  });
  readonly lockConflicts = new Counter({
    name: 'wager_lock_conflicts_total',
    help: 'SQL deadlocks, serialization conflicts or lock timeouts',
    registers: [this.registry],
  });
  readonly outboxLag = new Gauge({
    name: 'wager_outbox_lag_seconds',
    help: 'Age of oldest unpublished event',
    registers: [this.registry],
  });
  readonly reconciliationDivergences = new Counter({
    name: 'wager_reconciliation_divergences_total',
    help: 'Detected inconsistent wallet/ledger snapshots',
    registers: [this.registry],
  });
  readonly latency = new Histogram({
    name: 'wager_processing_seconds',
    help: 'Request processing latency',
    labelNames: ['transport'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });
}

export function errorCode(error: unknown): string {
  return (
    (error as { code?: string; name?: string })?.code ??
    (error as { name?: string })?.name ??
    'UNKNOWN_ERROR'
  );
}
