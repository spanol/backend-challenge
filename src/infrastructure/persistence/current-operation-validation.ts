import { financialValidationWithSnapshotSql } from './schema';
import {
  InfrastructureErrorCode,
  PersistenceErrorMessage,
  PostgresErrorCode,
} from '../constants/errors';

// Immutable terminal transactions/ledger retain their previously checked links.
// Every insert/update still checks the full balance, version and ledger chain.
export const currentOperationValidationSql = financialValidationWithSnapshotSql
  .replace(
    "IF TG_TABLE_NAME='wager_transactions' THEN tid := (to_jsonb(NEW)->>'id')::uuid; END IF;",
    `IF TG_TABLE_NAME='wager_transactions' THEN tid := (to_jsonb(NEW)->>'id')::uuid;
   ELSIF TG_TABLE_NAME='wallet_ledger' THEN tid := NEW.transaction_id;
   ELSIF TG_OP='UPDATE' AND (NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
     RAISE EXCEPTION '${PersistenceErrorMessage.TRANSACTION_LEDGER_MISMATCH}' USING ERRCODE='${PostgresErrorCode.CHECK_VIOLATION}';
   END IF;`,
  )
  .replace('WHERE t.wallet_id=wid AND (', 'WHERE t.wallet_id=wid AND t.id=tid AND (')
  .replace('WHERE l.wallet_id=wid AND (', 'WHERE l.wallet_id=wid AND l.transaction_id=tid AND (');

if (
  !currentOperationValidationSql.includes("ELSIF TG_TABLE_NAME='wallet_ledger'") ||
  !currentOperationValidationSql.includes('t.wallet_id=wid AND t.id=tid') ||
  !currentOperationValidationSql.includes('l.wallet_id=wid AND l.transaction_id=tid')
)
  throw new Error(InfrastructureErrorCode.CURRENT_OPERATION_SQL_ASSEMBLY_FAILED);
