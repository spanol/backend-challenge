import { connectDatabase } from '../src/infrastructure/persistence/database';

const password = process.env.POSTGRES_APP_PASSWORD;

if (!password || !/^[a-f0-9]{64}$/.test(password))
  throw new Error('POSTGRES_APP_PASSWORD must be a generated 64-character hexadecimal secret');

const db = await connectDatabase(true);

try {
  const rows = await db.em
    .fork()
    .execute<{ exists: boolean }[]>(
      "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wagering_app') exists",
    );

  if (!rows[0]!.exists)
    await db.em.fork().execute('CREATE ROLE wagering_app LOGIN PASSWORD ?', [password]);
} finally {
  await db.close(true);
}
