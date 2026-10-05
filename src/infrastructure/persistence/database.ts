import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { entities } from './entities';
import { Migration202609300001 } from './migrations/Migration202609300001';
import { Migration202609300002 } from './migrations/Migration202609300002';
import { Migration202609300003 } from './migrations/Migration202609300003';
import { Migration202609300004 } from './migrations/Migration202609300004';
import { Migration202609300005 } from './migrations/Migration202609300005';
import { Migration202610010006 } from './migrations/Migration202610010006';
import { Migration202610010007 } from './migrations/Migration202610010007';
import { Migration202610010008 } from './migrations/Migration202610010008';
import { Migration202610050009 } from './migrations/Migration202610050009';
import { Migration202610050010 } from './migrations/Migration202610050010';
import type { Database } from './types/database';

export async function connectDatabase(admin = false): Promise<Database> {
  return MikroORM.init({
    clientUrl: admin
      ? (process.env.DATABASE_ADMIN_URL ??
        'postgresql://wagering_owner:local-owner-only@127.0.0.1:55432/wagering')
      : (process.env.DATABASE_URL ??
        'postgresql://wagering_app:local-app-only@127.0.0.1:55432/wagering'),
    entities,
    extensions: [Migrator],
    debug: false,
    pool: { min: 0, max: 12 },
    migrations: {
      migrationsList: [
        { name: 'Migration202609300001', class: Migration202609300001 },
        { name: 'Migration202609300002', class: Migration202609300002 },
        { name: 'Migration202609300003', class: Migration202609300003 },
        { name: 'Migration202609300004', class: Migration202609300004 },
        { name: 'Migration202609300005', class: Migration202609300005 },
        { name: 'Migration202610010006', class: Migration202610010006 },
        { name: 'Migration202610010007', class: Migration202610010007 },
        { name: 'Migration202610010008', class: Migration202610010008 },
        { name: 'Migration202610050009', class: Migration202610050009 },
        { name: 'Migration202610050010', class: Migration202610050010 },
      ],
      transactional: true,
      allOrNothing: true,
    },
  });
}
