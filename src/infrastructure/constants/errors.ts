export enum InfrastructureErrorCode {
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INVALID_PERSISTED_DECIMAL = 'INVALID_PERSISTED_DECIMAL',
  FINANCIAL_SNAPSHOT_SQL_ASSEMBLY_FAILED = 'FINANCIAL_SNAPSHOT_SQL_ASSEMBLY_FAILED',
}

export enum PersistenceErrorMessage {
  LEDGER_IS_IMMUTABLE = 'ledger is immutable',
  TRANSACTION_IS_IMMUTABLE = 'transaction is immutable',
  TRANSACTION_PAYLOAD_IS_IMMUTABLE = 'transaction business payload is immutable',
  WALLET_LEDGER_MISMATCH = 'wallet balance/version does not match ledger',
  LEDGER_CHAIN_IS_INCONSISTENT = 'ledger chain is inconsistent',
  TRANSACTION_LEDGER_MISMATCH = 'transaction does not match wallet/ledger',
  INVALID_FINANCIAL_REFERENCE = 'invalid financial reference/direction',
  ACCOUNTING_JOURNAL_IS_UNBALANCED = 'accounting journal is unbalanced or inconsistent',
  ACCOUNTING_HISTORY_SOURCE_IS_INVALID = 'accounting journal history source is inconsistent',
}

export enum PostgresErrorCode {
  UNIQUE_VIOLATION = '23505',
  CHECK_VIOLATION = '23514',
  DEADLOCK_DETECTED = '40P01',
  SERIALIZATION_FAILURE = '40001',
  LOCK_NOT_AVAILABLE = '55P03',
}
