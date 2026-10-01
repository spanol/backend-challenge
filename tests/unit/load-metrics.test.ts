import { expect, test } from 'bun:test';
import { isOutboxDrained, loadSample, metric, samplePeak } from '../../scripts/load-metrics';

test('load metrics preserve zero and distinguish unavailable or nonfinite values', () => {
  expect(metric('wager_outbox_pending 0\n', 'wager_outbox_pending')).toBe(0);
  expect(metric('other 1\n', 'wager_outbox_pending')).toBeNull();
  expect(metric('value NaN\n', 'value')).toBeNull();
  expect(metric('value +Inf\n', 'value')).toBeNull();
  expect(metric('value 1.2e+3\n', 'value')).toBe(1200);
});

test('load CPU uses elapsed seconds and rejects counter resets or identical timestamps', () => {
  const at = new Date('2026-10-01T12:00:00.000Z');
  const later = new Date('2026-10-01T12:00:02.000Z');
  const previous = loadSample('process_cpu_seconds_total 10', 'baseline', undefined, at);

  expect(loadSample('process_cpu_seconds_total 13', 'load', previous, later).cpuPercent).toBe(150);
  expect(loadSample('process_cpu_seconds_total 1', 'load', previous, later).cpuPercent).toBeNull();
  expect(loadSample('process_cpu_seconds_total 13', 'load', previous, at).cpuPercent).toBeNull();
  expect(loadSample('', 'load', previous, later).cpuPercent).toBeNull();
});

test('load resource peaks exclude missing data without inventing a zero sample', () => {
  const samples = [
    loadSample('', 'baseline'),
    loadSample('process_resident_memory_bytes 1234', 'load'),
  ];

  expect(samplePeak(samples, 'rssBytes')).toBe(1234);
  expect(samplePeak(samples, 'outboxPending')).toBeNull();
  expect(samplePeak([], 'rssBytes')).toBeNull();
});

test('outbox drain requires a completed telemetry collection after the load', () => {
  expect(isOutboxDrained(loadSample('wager_outbox_pending 0', 'recovery'), 100)).toBe(false);
  expect(
    isOutboxDrained(
      loadSample('wager_outbox_pending 0\nwager_telemetry_timestamp_seconds 99', 'recovery'),
      100,
    ),
  ).toBe(false);
  expect(
    isOutboxDrained(
      loadSample('wager_outbox_pending 1\nwager_telemetry_timestamp_seconds 101', 'recovery'),
      100,
    ),
  ).toBe(false);
  expect(
    isOutboxDrained(
      loadSample('wager_outbox_pending 0\nwager_telemetry_timestamp_seconds 101', 'recovery'),
      100,
    ),
  ).toBe(true);
});
