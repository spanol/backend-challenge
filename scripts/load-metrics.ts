import type { LoadSample } from './types/load';

export function metric(text: string, name: string): number | null {
  const match = text.match(new RegExp(`^${name} ([^ ]+)$`, 'm'));
  const value = match ? Number(match[1]) : NaN;

  return Number.isFinite(value) ? value : null;
}

export function loadSample(
  text: string,
  phase: string,
  previous?: LoadSample,
  now = new Date(),
): LoadSample {
  const at = now.toISOString();
  const cpuSeconds = metric(text, 'process_cpu_seconds_total');
  const elapsedSeconds = previous ? (Date.parse(at) - Date.parse(previous.at)) / 1000 : 0;

  return {
    at,
    phase,
    cpuSeconds,
    cpuPercent:
      previous?.cpuSeconds !== null &&
      previous?.cpuSeconds !== undefined &&
      cpuSeconds !== null &&
      cpuSeconds >= previous.cpuSeconds &&
      elapsedSeconds > 0
        ? (100 * (cpuSeconds - previous.cpuSeconds)) / elapsedSeconds
        : null,
    rssBytes: metric(text, 'process_resident_memory_bytes'),
    heapBytes: metric(text, 'nodejs_heap_size_used_bytes'),
    eventLoopP99Seconds: metric(text, 'nodejs_eventloop_lag_p99_seconds'),
    outboxPending: metric(text, 'wager_outbox_pending'),
    telemetryTimestampSeconds: metric(text, 'wager_telemetry_timestamp_seconds'),
    outboxLagSeconds: metric(text, 'wager_outbox_lag_seconds'),
    lockConflicts: metric(text, 'wager_lock_conflicts_total'),
  };
}

export function samplePeak(samples: LoadSample[], field: keyof LoadSample): number | null {
  const values = samples.map((sample) => sample[field]).filter((v) => typeof v === 'number');

  return values.length ? Math.max(...values) : null;
}

export function isOutboxDrained(sample: LoadSample, sinceSeconds: number): boolean {
  return (
    sample.outboxPending === 0 &&
    sample.telemetryTimestampSeconds !== null &&
    sample.telemetryTimestampSeconds >= sinceSeconds
  );
}
