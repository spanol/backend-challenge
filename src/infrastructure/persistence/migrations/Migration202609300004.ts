import { Migration } from '@mikro-orm/migrations';
import { financialValidationSql } from '../schema';

export class Migration202609300004 extends Migration {
  override async up(): Promise<void> {
    this.addSql(financialValidationSql);
    this.addSql('REVOKE UPDATE ON wallets,outbox FROM wagering_app');
    this.addSql('GRANT UPDATE(balance,version,updated_at) ON wallets TO wagering_app');
    this.addSql(
      'GRANT UPDATE(published_at,attempts,next_attempt_at,lease_token,lease_until) ON outbox TO wagering_app',
    );
  }

  override async down(): Promise<void> {
    this.addSql('REVOKE UPDATE(balance,version,updated_at) ON wallets FROM wagering_app');
    this.addSql(
      'REVOKE UPDATE(published_at,attempts,next_attempt_at,lease_token,lease_until) ON outbox FROM wagering_app',
    );
    this.addSql('GRANT UPDATE ON wallets,outbox TO wagering_app');
  }
}
