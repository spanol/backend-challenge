import type { Arrival, ArrivalStats } from './types/game-load';

/** Arrival times do not depend on response times. The queue belongs to the generator. */
export async function runArrivals(
  arrivals: Arrival[],
  options: { concurrency: number; maxQueued: number; maxWaitMs: number; windowMs: number },
  task: (arrival: Arrival, index: number) => Promise<void>,
): Promise<ArrivalStats> {
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    !Number.isSafeInteger(options.maxQueued) ||
    options.maxQueued < 1 ||
    options.maxWaitMs < 0 ||
    options.windowMs < 0 ||
    arrivals.some((a, i) => a.dueMs < 0 || (i > 0 && a.dueMs < arrivals[i - 1]!.dueMs))
  )
    throw new Error('Invalid arrival schedule');

  const stats: ArrivalStats = {
    offered: 0,
    started: 0,
    expired: 0,
    overflow: 0,
    failed: 0,
    maxInFlight: 0,
    maxQueued: 0,
    generatorLagMs: [],
    queueWaitMs: [],
    elapsedMs: 0,
  };
  const queue: number[] = [];
  const active = new Set<Promise<void>>();
  let head = 0;
  let next = 0;
  const start = performance.now();
  while (
    next < arrivals.length ||
    head < queue.length ||
    active.size > 0 ||
    performance.now() - start < options.windowMs
  ) {
    const now = performance.now() - start;
    while (next < arrivals.length && arrivals[next]!.dueMs <= now) {
      const index = next++;
      stats.offered++;
      stats.generatorLagMs.push(now - arrivals[index]!.dueMs);
      if (queue.length - head >= options.maxQueued) stats.overflow++;
      else queue.push(index);
    }
    while (head < queue.length) {
      const index = queue[head]!;
      const arrival = arrivals[index]!;
      const wait = performance.now() - start - arrival.dueMs;
      if (wait > options.maxWaitMs) {
        head++;
        stats.expired++;
        continue;
      }
      if (active.size >= options.concurrency) break;
      head++;
      stats.started++;
      stats.queueWaitMs.push(wait);
      const work = Promise.resolve()
        .then(() => task(arrival, index))
        .catch(() => {
          stats.failed++;
        })
        .finally(() => {
          active.delete(work);
        });
      active.add(work);
      stats.maxInFlight = Math.max(stats.maxInFlight, active.size);
    }
    stats.maxQueued = Math.max(stats.maxQueued, queue.length - head);
    await Bun.sleep(5);
  }
  stats.elapsedMs = performance.now() - start;
  return stats;
}

export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}
