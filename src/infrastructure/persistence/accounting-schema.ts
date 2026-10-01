import { AccountingAccountType } from '../../domain/constants/accounting';
import { WagerKind, WagerStatus } from '../../domain/constants/wager';
import { LedgerDirection } from '../../domain/constants/wallet';
import { PersistenceErrorMessage, PostgresErrorCode } from '../constants/errors';

const sqlValue = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const upAccountingSql = `
CREATE TABLE accounting_journals (
 transaction_id uuid PRIMARY KEY REFERENCES wager_transactions(id) DEFERRABLE INITIALLY DEFERRED,
 wallet_id uuid NOT NULL REFERENCES wallets(id) DEFERRABLE INITIALLY DEFERRED,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), created_at timestamptz NOT NULL
);
CREATE TABLE accounting_journal_lines (
 journal_id uuid NOT NULL REFERENCES accounting_journals(transaction_id) DEFERRABLE INITIALLY DEFERRED,
 line_number smallint NOT NULL CHECK(line_number IN (1,2)),
 account_type text NOT NULL CHECK(account_type IN (${sqlValue(AccountingAccountType.WALLET_LIABILITY)},${sqlValue(AccountingAccountType.PLATFORM_CLEARING)})),
 account_id uuid REFERENCES wallets(id) DEFERRABLE INITIALLY DEFERRED,
 direction text NOT NULL CHECK(direction IN (${sqlValue(LedgerDirection.DEBIT)},${sqlValue(LedgerDirection.CREDIT)})),
 amount numeric(20,2) NOT NULL CHECK(amount>0),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 PRIMARY KEY(journal_id,line_number), UNIQUE(journal_id,account_type),
 CHECK((account_type=${sqlValue(AccountingAccountType.WALLET_LIABILITY)} AND account_id IS NOT NULL) OR
       (account_type=${sqlValue(AccountingAccountType.PLATFORM_CLEARING)} AND account_id IS NULL))
);
DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM wager_transactions t
   LEFT JOIN wallet_ledger w ON w.transaction_id=t.id AND w.wallet_id=t.wallet_id
   WHERE t.status=${sqlValue(WagerStatus.PROCESSED)} AND t.kind<>${sqlValue(WagerKind.LOSS)}
     AND (w.id IS NULL OR w.amount<>t.amount OR w.currency<>t.currency)
 ) THEN
   RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.ACCOUNTING_HISTORY_SOURCE_IS_INVALID)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
 END IF;
END $$;
INSERT INTO accounting_journals(transaction_id,wallet_id,currency,created_at)
 SELECT t.id,t.wallet_id,t.currency,w.created_at
 FROM wager_transactions t JOIN wallet_ledger w ON w.transaction_id=t.id AND w.wallet_id=t.wallet_id
 WHERE t.status=${sqlValue(WagerStatus.PROCESSED)} AND t.kind<>${sqlValue(WagerKind.LOSS)};
INSERT INTO accounting_journal_lines(journal_id,line_number,account_type,account_id,direction,amount,currency)
 SELECT j.transaction_id,1,${sqlValue(AccountingAccountType.WALLET_LIABILITY)},j.wallet_id,w.direction,w.amount,w.currency
 FROM accounting_journals j JOIN wallet_ledger w ON w.transaction_id=j.transaction_id;
INSERT INTO accounting_journal_lines(journal_id,line_number,account_type,account_id,direction,amount,currency)
 SELECT j.transaction_id,2,${sqlValue(AccountingAccountType.PLATFORM_CLEARING)},NULL,
        CASE WHEN w.direction=${sqlValue(LedgerDirection.CREDIT)} THEN ${sqlValue(LedgerDirection.DEBIT)} ELSE ${sqlValue(LedgerDirection.CREDIT)} END,
        w.amount,w.currency
 FROM accounting_journals j JOIN wallet_ledger w ON w.transaction_id=j.transaction_id;
CREATE FUNCTION immutable_accounting_journal() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.LEDGER_IS_IMMUTABLE)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)}; END; $$;
CREATE TRIGGER accounting_journal_no_update_delete BEFORE UPDATE OR DELETE ON accounting_journals FOR EACH ROW EXECUTE FUNCTION immutable_accounting_journal();
CREATE TRIGGER accounting_journal_no_truncate BEFORE TRUNCATE ON accounting_journals FOR EACH STATEMENT EXECUTE FUNCTION immutable_accounting_journal();
CREATE TRIGGER accounting_line_no_update_delete BEFORE UPDATE OR DELETE ON accounting_journal_lines FOR EACH ROW EXECUTE FUNCTION immutable_accounting_journal();
CREATE TRIGGER accounting_line_no_truncate BEFORE TRUNCATE ON accounting_journal_lines FOR EACH STATEMENT EXECUTE FUNCTION immutable_accounting_journal();
CREATE FUNCTION validate_accounting_journal() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE tid uuid; expected integer; journals integer; lines integer; debits integer; credits integer;
         debit_total numeric; credit_total numeric; invalid integer;
 BEGIN
   IF TG_TABLE_NAME='wager_transactions' THEN tid := NEW.id;
   ELSIF TG_TABLE_NAME IN ('wallet_ledger','accounting_journals') THEN tid := NEW.transaction_id;
   ELSE tid := NEW.journal_id; END IF;
   SELECT CASE WHEN status=${sqlValue(WagerStatus.PROCESSED)} AND kind<>${sqlValue(WagerKind.LOSS)} THEN 1 ELSE 0 END
     INTO expected FROM wager_transactions WHERE id=tid;
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT COUNT(*) INTO journals FROM accounting_journals WHERE transaction_id=tid;
   IF journals<>expected THEN
     RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.ACCOUNTING_JOURNAL_IS_UNBALANCED)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
   END IF;
   IF expected=0 THEN RETURN NULL; END IF;
   SELECT COUNT(*), COUNT(*) FILTER(WHERE direction=${sqlValue(LedgerDirection.DEBIT)}),
          COUNT(*) FILTER(WHERE direction=${sqlValue(LedgerDirection.CREDIT)}),
          COALESCE(SUM(amount) FILTER(WHERE direction=${sqlValue(LedgerDirection.DEBIT)}),0),
          COALESCE(SUM(amount) FILTER(WHERE direction=${sqlValue(LedgerDirection.CREDIT)}),0)
     INTO lines,debits,credits,debit_total,credit_total
     FROM accounting_journal_lines WHERE journal_id=tid;
   IF lines<>2 OR debits<>1 OR credits<>1 OR debit_total<>credit_total THEN
     RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.ACCOUNTING_JOURNAL_IS_UNBALANCED)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
   END IF;
   SELECT COUNT(*) INTO invalid
     FROM accounting_journals j
     JOIN wager_transactions t ON t.id=j.transaction_id
     LEFT JOIN wallet_ledger w ON w.transaction_id=t.id AND w.wallet_id=t.wallet_id
     JOIN accounting_journal_lines p ON p.journal_id=j.transaction_id
     WHERE t.id=tid AND (
       j.wallet_id<>t.wallet_id OR j.currency<>t.currency OR w.id IS NULL OR
       w.amount<>t.amount OR w.currency<>t.currency OR
       (p.account_type=${sqlValue(AccountingAccountType.WALLET_LIABILITY)} AND
         (p.account_id IS DISTINCT FROM j.wallet_id OR p.direction IS DISTINCT FROM w.direction)) OR
       (p.account_type=${sqlValue(AccountingAccountType.PLATFORM_CLEARING)} AND
         (p.account_id IS NOT NULL OR p.direction=w.direction)) OR
       p.amount<>t.amount OR p.currency<>t.currency
     );
   IF invalid>0 THEN
     RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.ACCOUNTING_JOURNAL_IS_UNBALANCED)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
   END IF;
   RETURN NULL;
 END; $$;
CREATE CONSTRAINT TRIGGER accounting_transaction_coherence AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_accounting_journal();
CREATE CONSTRAINT TRIGGER accounting_wallet_ledger_coherence AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_accounting_journal();
CREATE CONSTRAINT TRIGGER accounting_journal_coherence AFTER INSERT ON accounting_journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_accounting_journal();
CREATE CONSTRAINT TRIGGER accounting_line_coherence AFTER INSERT ON accounting_journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_accounting_journal();
GRANT SELECT,INSERT ON accounting_journals,accounting_journal_lines TO wagering_app;
`;

export const downAccountingSql = `
DROP TRIGGER accounting_transaction_coherence ON wager_transactions;
DROP TRIGGER accounting_wallet_ledger_coherence ON wallet_ledger;
DROP TABLE accounting_journal_lines,accounting_journals CASCADE;
DROP FUNCTION validate_accounting_journal(),immutable_accounting_journal();
`;
