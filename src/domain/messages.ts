import { DomainError } from './money';
import type { EventEnvelope } from './types/events';
import { type IntegrationEvent, freezeJson } from './events';
import type { InboxState, OutboxState } from './types/messages';

export class InboxMessage {
  private constructor(private state: InboxState) {
    this.state = {
      ...state,
      receivedAt: new Date(state.receivedAt),
      processedAt: state.processedAt && new Date(state.processedAt),
    };
  }

  static receive(props: Omit<InboxState, 'processedAt'>): InboxMessage {
    return new this({ ...props });
  }

  static rehydrate(state: InboxState): InboxMessage {
    return new this({ ...state });
  }

  get consumerName(): string {
    return this.state.consumerName;
  }

  get messageId(): string {
    return this.state.messageId;
  }

  get payloadHash(): string {
    return this.state.payloadHash;
  }

  get receivedAt(): Date {
    return new Date(this.state.receivedAt);
  }

  get processedAt(): Date | undefined {
    return this.state.processedAt && new Date(this.state.processedAt);
  }

  isProcessed(): boolean {
    return !!this.processedAt;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) throw new DomainError('INBOX_ALREADY_PROCESSED');

    this.state = { ...this.state, processedAt: new Date(at) };
  }
}

export class OutboxMessage {
  private constructor(private state: OutboxState) {
    this.state = {
      ...state,
      occurredAt: new Date(state.occurredAt),
      nextAttemptAt: state.nextAttemptAt && new Date(state.nextAttemptAt),
      publishedAt: state.publishedAt && new Date(state.publishedAt),
    };
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new this({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: freezeJson(event.toJSON()),
      occurredAt: event.occurredAt,
      attempts: 0,
    });
  }

  static rehydrate(state: OutboxState): OutboxMessage {
    return new this({ ...state, payload: freezeJson(structuredClone(state.payload)) });
  }

  get id(): string {
    return this.state.id;
  }

  get aggregateId(): string {
    return this.state.aggregateId;
  }

  get eventType(): string {
    return this.state.eventType;
  }

  get payload(): EventEnvelope {
    return this.state.payload;
  }

  get occurredAt(): Date {
    return new Date(this.state.occurredAt);
  }

  get attempts(): number {
    return this.state.attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this.state.nextAttemptAt && new Date(this.state.nextAttemptAt);
  }

  get publishedAt(): Date | undefined {
    return this.state.publishedAt && new Date(this.state.publishedAt);
  }

  isPending(): boolean {
    return !this.publishedAt;
  }

  isDue(now: Date): boolean {
    return this.isPending() && (!this.nextAttemptAt || this.nextAttemptAt <= now);
  }

  markPublished(at: Date): void {
    if (!this.isPending()) throw new DomainError('OUTBOX_ALREADY_PUBLISHED');

    this.state = { ...this.state, publishedAt: new Date(at) };
  }

  scheduleRetry(now: Date): void {
    if (!this.isPending()) throw new DomainError('OUTBOX_ALREADY_PUBLISHED');

    this.state = {
      ...this.state,
      attempts: this.attempts + 1,
      nextAttemptAt: new Date(now.getTime() + retryDelay(this.attempts)),
    };
  }
}

export function retryDelay(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
}
