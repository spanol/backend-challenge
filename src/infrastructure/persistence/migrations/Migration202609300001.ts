import { Migration } from '@mikro-orm/migrations';
import { upSql, downSql } from '../schema';

export class Migration202609300001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(upSql);
  }

  override async down(): Promise<void> {
    this.addSql(downSql);
  }
}
