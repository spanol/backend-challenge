import { Migration } from '@mikro-orm/migrations';

export class Migration202610050009 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'CREATE INDEX outbox_pending_telemetry ON outbox(occurred_at) WHERE published_at IS NULL',
    );
    this.addSql(
      "CREATE INDEX wager_opening_wallet ON wager_transactions(wallet_id) WHERE kind='OPENING' AND status='PROCESSED'",
    );
  }

  override async down(): Promise<void> {
    this.addSql('DROP INDEX outbox_pending_telemetry');
    this.addSql('DROP INDEX wager_opening_wallet');
  }
}
