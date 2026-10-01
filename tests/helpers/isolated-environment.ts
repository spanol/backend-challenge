export function requireTestIsolation(
  env: Record<string, string | undefined> = process.env,
): string {
  const name = env.TEST_RESOURCE_ID;

  if (!name || !/^wagering_test_[0-9]+_[a-f0-9]{8}$/.test(name)) {
    throw new Error(
      'Use bun run test:integration, test:concurrency, test:idp or test:all to isolate resources.',
    );
  }

  for (const key of ['DATABASE_URL', 'DATABASE_ADMIN_URL']) {
    if (!env[key] || new URL(env[key]).pathname !== `/${name}`) {
      throw new Error(`Test isolation mismatch in ${key}`);
    }
  }

  if (env.QUEUE_PREFIX !== `${name}-`) throw new Error('Test isolation mismatch in QUEUE_PREFIX');

  return name;
}
