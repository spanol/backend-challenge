import { Migration } from '@mikro-orm/migrations';
import { financialValidationSql, previousFinancialValidationSql } from '../schema';

export class Migration202609300003 extends Migration {
  override async up(): Promise<void> {
    this.addSql(financialValidationSql);
  }

  override async down(): Promise<void> {
    this.addSql(previousFinancialValidationSql);
  }
}
