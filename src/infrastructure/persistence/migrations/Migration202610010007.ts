import { Migration } from '@mikro-orm/migrations';
import { downAccountingSql, upAccountingSql } from '../accounting-schema';

export class Migration202610010007 extends Migration {
  override async up(): Promise<void> {
    this.addSql(upAccountingSql);
  }

  override async down(): Promise<void> {
    this.addSql(downAccountingSql);
  }
}
