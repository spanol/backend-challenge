export enum ConsumerName {
  WAGER_TRANSACTIONS = 'wager-transactions',
}

export enum MessageGroup {
  INVALID_MESSAGES = 'invalid-messages',
}

export enum WorkerSource {
  SQS = 'sqs',
  OUTBOX = 'outbox',
  REFERENCES = 'references',
  TELEMETRY = 'telemetry',
  DLQ_AUDIT = 'dlq-audit',
}
