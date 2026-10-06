import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { InfrastructureErrorCode } from './constants/errors';
import type { LogEvent } from './constants/log-events';

export function log(event: LogEvent, fields: Record<string, unknown> = {}): void {
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
  readonly httpResponses = new Counter({
    name: 'wager_http_responses_total',
    help: 'Wager command HTTP responses by status code, including infrastructure failures',
    labelNames: ['status_code'],
    registers: [this.registry],
  });
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
  readonly outboxPending = new Gauge({
    name: 'wager_outbox_pending',
    help: 'Durable outbox events awaiting publication',
    registers: [this.registry],
  });
  readonly outboxPublished = new Counter({
    name: 'wager_outbox_published_total',
    help: 'Events accepted by SQS and confirmed with the current SQL lease token',
    registers: [this.registry],
  });
  readonly eventQueueDepth = new Gauge({
    name: 'wager_event_queue_depth',
    help: 'Approximate visible plus in-flight events at the last publisher backpressure check',
    registers: [this.registry],
  });
  readonly telemetryTimestamp = new Gauge({
    name: 'wager_telemetry_timestamp_seconds',
    help: 'Start timestamp of the last completed SQL and queue telemetry collection',
    registers: [this.registry],
  });
  readonly requestQueueVisible = new Gauge({
    name: 'wager_request_queue_visible',
    help: 'Approximate request queue messages available for consumption',
    registers: [this.registry],
  });
  readonly requestQueueInflight = new Gauge({
    name: 'wager_request_queue_inflight',
    help: 'Approximate request queue messages currently in flight',
    registers: [this.registry],
  });
  readonly requestQueueDelayed = new Gauge({
    name: 'wager_request_queue_delayed',
    help: 'Approximate request queue messages waiting for a delivery delay',
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

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}

export function errorCode(error: unknown): string {
  return (
    (error as { code?: string; name?: string })?.code ??
    (error as { name?: string })?.name ??
    InfrastructureErrorCode.UNKNOWN_ERROR
  );
}
