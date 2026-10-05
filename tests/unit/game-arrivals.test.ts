import { expect, test } from 'bun:test';
import { runArrivals } from '../../scripts/game-arrivals';

test('slow service preserves offered arrivals and bounds generator concurrency', async () => {
  let active = 0;
  let peak = 0;
  const result = await runArrivals(
    Array.from({ length: 50 }, (_, player) => ({ player, dueMs: 0 })),
    { concurrency: 2, maxQueued: 50, maxWaitMs: 15, windowMs: 0 },
    async () => {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(50);
      active--;
    },
  );
  expect(result.offered).toBe(50);
  expect(result.started).toBe(2);
  expect(result.expired).toBe(48);
  expect(result.overflow).toBe(0);
  expect(peak).toBe(2);
});

test('overflow and service failures remain visible without abandoning later arrivals', async () => {
  const result = await runArrivals(
    Array.from({ length: 10 }, (_, player) => ({ player, dueMs: 0 })),
    { concurrency: 1, maxQueued: 3, maxWaitMs: 1000, windowMs: 0 },
    () => Promise.reject(new Error('transport failure')),
  );
  expect(result.offered).toBe(10);
  expect(result.started).toBe(3);
  expect(result.failed).toBe(3);
  expect(result.overflow).toBe(7);
  expect(result.expired).toBe(0);
});
