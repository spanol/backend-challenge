import {
  creditedReferenceKinds,
  directReversalKinds,
  failedWagerStatuses,
  rollbackReferenceKinds,
  terminalWagerStatuses,
  WagerKind,
  WagerStatus,
} from '../../domain/constants/wager';
import { LedgerDirection } from '../../domain/constants/wallet';
import {
  InfrastructureErrorCode,
  PersistenceErrorMessage,
  PostgresErrorCode,
} from '../constants/errors';

const sqlValue = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlList = <T extends string>(values: readonly T[]): string =>
  values.map((value) => sqlValue(value)).join(',');
const wagerKindsSql = sqlList(Object.values(WagerKind));
const wagerStatusesSql = sqlList(Object.values(WagerStatus));
const terminalStatusesSql = sqlList(terminalWagerStatuses);
const failedStatusesSql = sqlList(failedWagerStatuses);
const directReversalKindsSql = sqlList(directReversalKinds);
const rollbackReferenceKindsSql = sqlList(rollbackReferenceKinds);
const creditedReferenceKindsSql = sqlList(creditedReferenceKinds);
const ledgerDirectionsSql = sqlList(Object.values(LedgerDirection));

export const upSql = `
CREATE TABLE wallets (
 id uuid PRIMARY KEY, player_id text NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 balance numeric(20,2) NOT NULL CHECK(balance >= 0), version integer NOT NULL CHECK(version >= 1),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, UNIQUE(player_id,currency)
);
CREATE TABLE wager_transactions (
 id uuid PRIMARY KEY, provider_id text NOT NULL, external_transaction_id text NOT NULL, idempotency_key text NOT NULL UNIQUE,
 payload_hash text NOT NULL CHECK(length(payload_hash)=64), wallet_id uuid NOT NULL REFERENCES wallets(id) DEFERRABLE INITIALLY DEFERRED,
 player_id text NOT NULL, round_id text NOT NULL, game_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN (${wagerKindsSql})), amount numeric(20,2) NOT NULL,
 currency text NOT NULL, status text NOT NULL CHECK(status IN (${wagerStatusesSql})),
 reference_external_transaction_id text, reference_transaction_id uuid REFERENCES wager_transactions(id) DEFERRABLE INITIALLY DEFERRED,
 failure_code text, result jsonb, created_at timestamptz NOT NULL, processed_at timestamptz,
 reference_attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL, lease_token uuid, lease_until timestamptz,
 UNIQUE(provider_id,external_transaction_id),
 CHECK((kind=${sqlValue(WagerKind.LOSS)} AND amount>=0) OR (kind<>${sqlValue(WagerKind.LOSS)} AND amount>0)),
 CHECK(kind NOT IN (${directReversalKindsSql}) OR reference_external_transaction_id IS NOT NULL),
 CHECK((status IN (${terminalStatusesSql})) = (result IS NOT NULL)),
 CHECK(status <> ${sqlValue(WagerStatus.PROCESSED)} OR processed_at IS NOT NULL),
 CHECK(status NOT IN (${failedStatusesSql}) OR failure_code IS NOT NULL)
);
CREATE UNIQUE INDEX one_direct_reversal ON wager_transactions(reference_transaction_id)
 WHERE status=${sqlValue(WagerStatus.PROCESSED)} AND kind IN (${directReversalKindsSql});
CREATE INDEX pending_reference_due ON wager_transactions(next_attempt_at,id) WHERE status=${sqlValue(WagerStatus.PENDING_REFERENCE)};
CREATE TABLE wallet_ledger (
 id uuid PRIMARY KEY, wallet_id uuid NOT NULL REFERENCES wallets(id) DEFERRABLE INITIALLY DEFERRED,
 transaction_id uuid NOT NULL REFERENCES wager_transactions(id) DEFERRABLE INITIALLY DEFERRED,
 direction text NOT NULL CHECK(direction IN (${ledgerDirectionsSql})), amount numeric(20,2) NOT NULL CHECK(amount>0), currency text NOT NULL,
 balance_before numeric(20,2) NOT NULL CHECK(balance_before>=0), balance_after numeric(20,2) NOT NULL CHECK(balance_after>=0),
 wallet_version integer NOT NULL CHECK(wallet_version>=1), created_at timestamptz NOT NULL,
 UNIQUE(wallet_id,transaction_id), UNIQUE(wallet_id,wallet_version),
 CHECK(balance_after = balance_before + CASE WHEN direction=${sqlValue(LedgerDirection.CREDIT)} THEN amount ELSE -amount END)
);
CREATE INDEX ledger_cursor ON wallet_ledger(wallet_id,wallet_version);
CREATE TABLE inbox (
 consumer_name text NOT NULL, message_id text NOT NULL, payload_hash text NOT NULL CHECK(length(payload_hash)=64),
 transaction_id uuid NOT NULL REFERENCES wager_transactions(id) DEFERRABLE INITIALLY DEFERRED,
 received_at timestamptz NOT NULL, processed_at timestamptz NOT NULL, PRIMARY KEY(consumer_name,message_id)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY, aggregate_id uuid NOT NULL REFERENCES wallets(id) DEFERRABLE INITIALLY DEFERRED,
 event_type text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL, published_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL, lease_token uuid, lease_until timestamptz,
 CHECK(payload->>'eventId'=id::text), CHECK(payload->>'aggregateId'=aggregate_id::text)
);
CREATE INDEX outbox_due ON outbox(next_attempt_at,id) WHERE published_at IS NULL;
CREATE TABLE failed_deliveries (
 message_id text PRIMARY KEY, payload_hash text NOT NULL, failure_code text NOT NULL,
 transaction_id uuid, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE event_receipts (
 consumer_name text NOT NULL, event_id uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(consumer_name,event_id)
);
CREATE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.LEDGER_IS_IMMUTABLE)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)}; END; $$;
CREATE TRIGGER ledger_no_update_delete BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON wallet_ledger FOR EACH STATEMENT EXECUTE FUNCTION immutable_ledger();
CREATE FUNCTION immutable_terminal_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF TG_OP='DELETE' OR OLD.status IN (${terminalStatusesSql}) THEN
   RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.TRANSACTION_IS_IMMUTABLE)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
 END IF;
 IF (to_jsonb(NEW) - ARRAY['status','reference_transaction_id','failure_code','result','processed_at','reference_attempts','next_attempt_at','lease_token','lease_until'])
   IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','reference_transaction_id','failure_code','result','processed_at','reference_attempts','next_attempt_at','lease_token','lease_until']) THEN
   RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.TRANSACTION_PAYLOAD_IS_IMMUTABLE)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
 END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER transaction_immutable BEFORE UPDATE OR DELETE ON wager_transactions FOR EACH ROW EXECUTE FUNCTION immutable_terminal_transaction();
CREATE FUNCTION validate_financial_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE wid uuid; w wallets%ROWTYPE; total numeric; entries integer; opening integer; invalid integer;
 BEGIN
 IF TG_TABLE_NAME='wallets' THEN wid := NEW.id; ELSE wid := NEW.wallet_id; END IF;
 SELECT * INTO w FROM wallets WHERE id=wid FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COALESCE(SUM(CASE WHEN direction=${sqlValue(LedgerDirection.CREDIT)} THEN amount ELSE -amount END),0), COUNT(*)
 INTO total, entries FROM wallet_ledger WHERE wallet_id=wid;
 SELECT COUNT(*) INTO opening FROM wager_transactions WHERE wallet_id=wid AND kind=${sqlValue(WagerKind.OPENING)} AND status=${sqlValue(WagerStatus.PROCESSED)};
 IF total <> w.balance OR w.version <> entries + (CASE WHEN opening=0 THEN 1 ELSE 0 END) OR opening>1 THEN
   RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.WALLET_LEDGER_MISMATCH)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)};
 END IF;
 SELECT COUNT(*) INTO invalid FROM (
   SELECT l.*, lag(balance_after,1,0::numeric) OVER (ORDER BY wallet_version) previous_balance,
     row_number() OVER (ORDER BY wallet_version) seq
   FROM wallet_ledger l WHERE wallet_id=wid
 ) chain WHERE balance_before<>previous_balance OR wallet_version<>seq+CASE WHEN opening=0 THEN 1 ELSE 0 END OR currency<>w.currency;
 IF invalid>0 THEN RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.LEDGER_CHAIN_IS_INCONSISTENT)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)}; END IF;
 SELECT COUNT(*) INTO invalid FROM wager_transactions t
 LEFT JOIN wallet_ledger l ON l.transaction_id=t.id AND l.wallet_id=t.wallet_id
 WHERE t.wallet_id=wid AND (
   (t.status=${sqlValue(WagerStatus.PROCESSED)} AND (t.currency<>w.currency OR t.player_id<>w.player_id OR (t.reference_external_transaction_id IS NOT NULL AND t.reference_transaction_id IS NULL))) OR
   (t.status=${sqlValue(WagerStatus.PROCESSED)} AND t.kind<>${sqlValue(WagerKind.LOSS)} AND (l.id IS NULL OR l.amount<>t.amount OR l.currency<>t.currency)) OR
   ((t.status<>${sqlValue(WagerStatus.PROCESSED)} OR t.kind=${sqlValue(WagerKind.LOSS)}) AND l.id IS NOT NULL) OR
   (t.status=${sqlValue(WagerStatus.PROCESSED)} AND t.result->'balance'->>'amount' IS DISTINCT FROM CASE WHEN t.kind=${sqlValue(WagerKind.LOSS)} THEN t.result->'balance'->>'amount' ELSE l.balance_after::text END)
 );
 IF invalid>0 THEN RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.TRANSACTION_LEDGER_MISMATCH)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)}; END IF;
 SELECT COUNT(*) INTO invalid FROM wallet_ledger l JOIN wager_transactions t ON t.id=l.transaction_id
 LEFT JOIN wager_transactions r ON r.id=t.reference_transaction_id
 WHERE l.wallet_id=wid AND (
   t.wallet_id<>l.wallet_id OR
   l.direction<>CASE WHEN t.kind=${sqlValue(WagerKind.BET)} THEN ${sqlValue(LedgerDirection.DEBIT)} WHEN t.kind=${sqlValue(WagerKind.ROLLBACK)} AND r.kind IN (${creditedReferenceKindsSql}) THEN ${sqlValue(LedgerDirection.DEBIT)} ELSE ${sqlValue(LedgerDirection.CREDIT)} END OR
   (t.kind=${sqlValue(WagerKind.OPENING)} AND (t.provider_id<>'internal' OR l.wallet_version<>1 OR l.balance_before<>0)) OR
   (t.kind IN (${directReversalKindsSql}) AND r.id IS NULL) OR
   (r.id IS NOT NULL AND (r.status<>${sqlValue(WagerStatus.PROCESSED)} OR r.wallet_id<>t.wallet_id OR r.player_id<>t.player_id OR r.currency<>t.currency OR r.provider_id<>t.provider_id OR r.round_id<>t.round_id OR r.external_transaction_id<>t.reference_external_transaction_id OR
     (t.kind IN (${directReversalKindsSql}) AND r.amount<>t.amount) OR
     (t.kind IN (${sqlValue(WagerKind.WIN)},${sqlValue(WagerKind.REFUND)}) AND r.kind<>${sqlValue(WagerKind.BET)}) OR (t.kind=${sqlValue(WagerKind.ROLLBACK)} AND r.kind NOT IN (${rollbackReferenceKindsSql}))))
 );
 IF invalid>0 THEN RAISE EXCEPTION ${sqlValue(PersistenceErrorMessage.INVALID_FINANCIAL_REFERENCE)} USING ERRCODE=${sqlValue(PostgresErrorCode.CHECK_VIOLATION)}; END IF;
 RETURN NULL; END; $$;
CREATE CONSTRAINT TRIGGER wallet_coherence AFTER INSERT OR UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_financial_wallet();
CREATE CONSTRAINT TRIGGER ledger_coherence AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_financial_wallet();
CREATE CONSTRAINT TRIGGER transaction_coherence AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_financial_wallet();
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wagering_app') THEN CREATE ROLE wagering_app LOGIN PASSWORD 'local-app-only'; END IF; END $$;
GRANT USAGE ON SCHEMA public TO wagering_app;
GRANT SELECT,INSERT,UPDATE ON wallets,wager_transactions,outbox TO wagering_app;
GRANT SELECT,INSERT ON wallet_ledger,inbox,failed_deliveries,event_receipts TO wagering_app;
`;

export const downSql = `
DROP TABLE event_receipts,failed_deliveries,outbox,inbox,wallet_ledger,wager_transactions,wallets CASCADE;
DROP FUNCTION validate_financial_wallet(),immutable_terminal_transaction(),immutable_ledger();
`;

export const previousFinancialValidationSql = upSql
  .slice(
    upSql.indexOf('CREATE FUNCTION validate_financial_wallet()'),
    upSql.indexOf('CREATE CONSTRAINT TRIGGER wallet_coherence'),
  )
  .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');

export const financialValidationSql = previousFinancialValidationSql.replace(
  "IF TG_TABLE_NAME='wallets' THEN wid := NEW.id; ELSE wid := NEW.wallet_id; END IF;",
  "wid := COALESCE((to_jsonb(NEW)->>'wallet_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);",
);

const financialResultValidation = `
    (t.result IS NOT NULL AND (
      t.result->>'transactionId' IS DISTINCT FROM t.id::text OR
      t.result->>'status' IS DISTINCT FROM t.status OR
      t.result->'balance'->>'currency' IS DISTINCT FROM w.currency
    )) OR
    (t.status=${sqlValue(WagerStatus.PROCESSED)} AND t.kind<>${sqlValue(WagerKind.LOSS)} AND (
      t.result->'balance'->>'amount' IS DISTINCT FROM l.balance_after::text OR
      (t.result ? 'snapshotVersion' AND (t.result->>'snapshotVersion')::integer<>l.wallet_version)
    )) OR
    (t.result ? 'snapshotVersion' AND (
      (t.result->>'snapshotVersion')::integer > w.version OR
      (snapshot.id IS NULL AND (t.result->>'snapshotVersion')::integer<>1) OR
      t.result->'balance'->>'amount' IS DISTINCT FROM COALESCE(snapshot.balance_after,0::numeric)::numeric(20,2)::text
    )) OR
    (t.id=tid AND t.status IN (${terminalStatusesSql}) AND NOT (t.result ? 'snapshotVersion'))`;

const lossBalanceValidationSql = `(t.status=${sqlValue(WagerStatus.PROCESSED)} AND t.result->'balance'->>'amount' IS DISTINCT FROM CASE WHEN t.kind=${sqlValue(WagerKind.LOSS)} THEN t.result->'balance'->>'amount' ELSE l.balance_after::text END)`;

export const financialValidationWithSnapshotSql = financialValidationSql
  .replace(
    'DECLARE wid uuid; w wallets%ROWTYPE; total numeric; entries integer; opening integer; invalid integer;',
    'DECLARE wid uuid; w wallets%ROWTYPE; total numeric; entries integer; opening integer; invalid integer; tid uuid;',
  )
  .replace(
    "wid := COALESCE((to_jsonb(NEW)->>'wallet_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);",
    "wid := COALESCE((to_jsonb(NEW)->>'wallet_id')::uuid,(to_jsonb(NEW)->>'id')::uuid);\n  IF TG_TABLE_NAME='wager_transactions' THEN tid := (to_jsonb(NEW)->>'id')::uuid; END IF;",
  )
  .replace(
    /LEFT JOIN wallet_ledger l ON l.transaction_id=t.id AND l.wallet_id=t.wallet_id\r?\n\s*WHERE/,
    `LEFT JOIN wallet_ledger l ON l.transaction_id=t.id AND l.wallet_id=t.wallet_id
  LEFT JOIN wallet_ledger snapshot ON snapshot.wallet_id=t.wallet_id AND snapshot.wallet_version=(t.result->>'snapshotVersion')::integer
  WHERE`,
  )
  .replace(lossBalanceValidationSql, financialResultValidation);

if (
  !financialValidationWithSnapshotSql.includes('t.id=tid') ||
  !financialValidationWithSnapshotSql.includes('LEFT JOIN wallet_ledger snapshot') ||
  financialValidationWithSnapshotSql.includes(
    `IS DISTINCT FROM CASE WHEN t.kind=${sqlValue(WagerKind.LOSS)}`,
  )
)
  throw new Error(InfrastructureErrorCode.FINANCIAL_SNAPSHOT_SQL_ASSEMBLY_FAILED);
