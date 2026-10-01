import type {
  EventContext,
  EventEnvelope,
  TransactionEventData,
  BalanceEventData,
} from './types/events';
import { IntegrationEventType } from './constants/events';

export function freezeJson<T>(data: T): Readonly<T> {
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) freezeJson(value);

    Object.freeze(data);
  }

  return data;
}

function freezeEvent<T extends IntegrationEvent<unknown>>(event: T): T {
  Object.freeze(event);

  return event;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: IntegrationEventType;
  readonly version = 1;
  readonly data: Readonly<T>;
  private readonly context: EventContext;

  protected constructor(context: EventContext, data: T) {
    this.context = Object.freeze({ ...context, occurredAt: new Date(context.occurredAt) });
    this.data = freezeJson(structuredClone(data));
  }

  get eventId(): string {
    return this.context.eventId;
  }

  get aggregateId(): string {
    return this.context.aggregateId;
  }

  get correlationId(): string {
    return this.context.correlationId;
  }

  get causationId(): string | undefined {
    return this.context.causationId;
  }

  get occurredAt(): Date {
    return new Date(this.context.occurredAt);
  }

  toJSON(): EventEnvelope<T> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId ? { causationId: this.causationId } : {}),
      occurredAt: this.occurredAt.toISOString(),
      data: this.data,
    };
  }
}

export class WagerTransactionProcessed extends IntegrationEvent<TransactionEventData> {
  readonly eventType = IntegrationEventType.WAGER_TRANSACTION_PROCESSED;

  static from(ctx: EventContext, data: TransactionEventData): WagerTransactionProcessed {
    return freezeEvent(new this(ctx, data));
  }
}

export class WagerTransactionRejected extends IntegrationEvent<TransactionEventData> {
  readonly eventType = IntegrationEventType.WAGER_TRANSACTION_REJECTED;

  static from(ctx: EventContext, data: TransactionEventData): WagerTransactionRejected {
    return freezeEvent(new this(ctx, data));
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<TransactionEventData> {
  readonly eventType = IntegrationEventType.WAGER_TRANSACTION_PENDING_REFERENCE;

  static from(ctx: EventContext, data: TransactionEventData): WagerTransactionPendingReference {
    return freezeEvent(new this(ctx, data));
  }
}

export class WagerTransactionFailed extends IntegrationEvent<TransactionEventData> {
  readonly eventType = IntegrationEventType.WAGER_TRANSACTION_FAILED;

  static from(ctx: EventContext, data: TransactionEventData): WagerTransactionFailed {
    return freezeEvent(new this(ctx, data));
  }
}

export class WalletBalanceChanged extends IntegrationEvent<BalanceEventData> {
  readonly eventType = IntegrationEventType.WALLET_BALANCE_CHANGED;

  static from(ctx: EventContext, data: BalanceEventData): WalletBalanceChanged {
    return freezeEvent(new this(ctx, data));
  }
}
