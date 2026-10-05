import { Migration } from '@mikro-orm/migrations';
import { currentOperationValidationSql } from '../current-operation-validation';
import { financialValidationWithSnapshotSql } from '../schema';

export class Migration202610050010 extends Migration {
  override async up(): Promise<void> {
    this.addSql(currentOperationValidationSql);
    this.addSql(
      'ALTER FUNCTION public.validate_financial_wallet() SET search_path TO pg_catalog, public, pg_temp',
    );
  }

  override async down(): Promise<void> {
    this.addSql(financialValidationWithSnapshotSql);
    this.addSql(
      'ALTER FUNCTION public.validate_financial_wallet() SET search_path TO pg_catalog, public, pg_temp',
    );
  }
}
