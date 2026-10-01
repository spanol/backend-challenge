import { Migration } from '@mikro-orm/migrations';

export class Migration202610010008 extends Migration {
  override async up(): Promise<void> {
    this.addSql('CREATE INDEX wager_transactions_wallet ON wager_transactions(wallet_id)');
  }

  override async down(): Promise<void> {
    this.addSql('DROP INDEX wager_transactions_wallet');
  }
}
