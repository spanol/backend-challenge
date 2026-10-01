import { connectDatabase } from '../src/infrastructure/persistence/database';

const orm = await connectDatabase(true);

try {
  if (Bun.argv[2] === 'down') await orm.getMigrator().down();
  else await orm.getMigrator().up();

  console.log(JSON.stringify({ event: 'migration_completed', direction: Bun.argv[2] ?? 'up' }));
} finally {
  await orm.close(true);
}
