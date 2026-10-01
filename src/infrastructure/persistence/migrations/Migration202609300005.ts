import { Migration } from '@mikro-orm/migrations';

export class Migration202609300005 extends Migration {
  override async up(): Promise<void> {
    // A caller's temp tables must never shadow the financial tables read by a constraint trigger.
    for (const name of [
      'validate_financial_wallet',
      'immutable_ledger',
      'immutable_terminal_transaction',
    ]) {
      this.addSql(`ALTER FUNCTION public.${name}() SET search_path TO pg_catalog, public, pg_temp`);
    }
  }

  override async down(): Promise<void> {
    for (const name of [
      'validate_financial_wallet',
      'immutable_ledger',
      'immutable_terminal_transaction',
    ]) {
      this.addSql(`ALTER FUNCTION public.${name}() RESET search_path`);
    }
  }
}
