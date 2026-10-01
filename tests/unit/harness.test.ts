import { expect, test } from 'bun:test';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { childHarness } from '../helpers/process-harness';

const name = 'wagering_test_123456789_deadbeef';

const isolated = {
  TEST_RESOURCE_ID: name,
  DATABASE_URL: `postgresql://app@localhost/${name}`,
  DATABASE_ADMIN_URL: `postgresql://owner@localhost/${name}`,
  QUEUE_PREFIX: `${name}-`,
};

test('real infrastructure suites require an isolated resource identity before connecting', () => {
  expect(() => requireTestIsolation({})).toThrow('Use bun run');
  expect(() => requireTestIsolation({ ...isolated, TEST_RESOURCE_ID: 'wagering' })).toThrow();
  expect(requireTestIsolation(isolated)).toBe(name);
});

test.each(['DATABASE_URL', 'DATABASE_ADMIN_URL', 'QUEUE_PREFIX'] as const)(
  'rejects shared resources even when the runner identity exists: %s',
  (key) => {
    const value = key === 'QUEUE_PREFIX' ? '' : 'postgresql://app@localhost/wagering';

    expect(() => requireTestIsolation({ ...isolated, [key]: value })).toThrow(`mismatch in ${key}`);
  },
);

test('process harness reports an early child exit instead of waiting for the IPC timeout', async () => {
  const harness = childHarness('fixture', new URL('../fixtures/exited-child.ts', import.meta.url));
  let failure: unknown;

  try {
    await harness.wait('ready');
  } catch (error) {
    failure = error;
  } finally {
    harness.kill();
  }

  expect(failure).toMatchObject({ message: 'Child fixture exited 7 before emitting ready' });
  expect(await harness.child.exited).toBe(7);
});
