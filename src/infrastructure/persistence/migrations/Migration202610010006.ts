import { Migration } from '@mikro-orm/migrations';
import { financialValidationSql, financialValidationWithSnapshotSql } from '../schema';

export class Migration202610010006 extends Migration {
  override async up(): Promise<void> {
    this.addSql(financialValidationWithSnapshotSql);
    this.addSql(
      'ALTER FUNCTION public.validate_financial_wallet() SET search_path TO pg_catalog, public, pg_temp',
    );
  }

  override async down(): Promise<void> {
    this.addSql(financialValidationSql);
    this.addSql(
      'ALTER FUNCTION public.validate_financial_wallet() SET search_path TO pg_catalog, public, pg_temp',
    );
  }
}
