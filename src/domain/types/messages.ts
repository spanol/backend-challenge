import type { EventEnvelope } from './events';
import type { IntegrationEventType } from '../constants/events';

export interface InboxState {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export interface OutboxState {
  id: string;
  aggregateId: string;
  eventType: IntegrationEventType;
  payload: EventEnvelope;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}
