export enum ConsumerName {
  WAGER_TRANSACTIONS = 'wager-transactions',
  DEMO_EVENT_AUDIT = 'demo-event-audit',
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
  EVENT_RECEIPTS = 'event-receipts',
}
