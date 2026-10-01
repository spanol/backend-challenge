import { Migration } from '@mikro-orm/migrations';

export class Migration202609300002 extends Migration {
  override async up(): Promise<void> {
    // Lease-only updates must not take wallet locks: otherwise a claimant can invert the financial lock order.
    this.addSql('DROP TRIGGER transaction_coherence ON wager_transactions');
    this.addSql(
      'CREATE CONSTRAINT TRIGGER transaction_coherence AFTER INSERT OR UPDATE OF status,result,reference_transaction_id ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_financial_wallet()',
    );
  }

  override async down(): Promise<void> {
    this.addSql('DROP TRIGGER transaction_coherence ON wager_transactions');
    this.addSql(
      'CREATE CONSTRAINT TRIGGER transaction_coherence AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_financial_wallet()',
    );
  }
}
