import { createHash, randomUUID } from 'node:crypto';
import { DomainError, Money } from '../domain/money';
import { FinancialErrorCode } from '../domain/constants/errors';
import { WagerKind, wagerKinds } from '../domain/constants/wager';
import {
  ApplicationErrorCode,
  IdentifierField,
  identifierErrorCodes,
  type PersistenceErrorCode,
  type RequestErrorCode,
} from './constants/errors';
import { HttpStatusCode } from './constants/http-status';
import type { WagerCommand } from '../domain/types/wager';
import type { Clock } from './types/execution';
import type { ProviderIdentityPort } from './types/provider';

export class RequestError extends Error {
  constructor(
    public readonly status: HttpStatusCode,
    public readonly code: RequestErrorCode,
  ) {
    super(code);
  }
}

export class PersistenceError extends Error {
  constructor(public readonly code: PersistenceErrorCode) {
    super(code);
    this.name = 'PersistenceError';
  }
}

export class PermanentInfrastructureError extends Error {}

export const systemClock: Clock = { now: () => new Date() };

export class DevelopmentProviderIdentity implements ProviderIdentityPort {
  validate(providerId: string): void {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(providerId) || providerId === 'internal')
      throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.INVALID_PROVIDER);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identifier(value: unknown, field: IdentifierField, uuid = false): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 200 ||
    (uuid && !uuidPattern.test(value))
  )
    throw new RequestError(HttpStatusCode.BAD_REQUEST, identifierErrorCodes[field]);

  return uuid ? value.toLowerCase() : value;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.INVALID_PAYLOAD);

  return value as Record<string, unknown>;
}

export function parseMoney(value: unknown): Money {
  const props = object(value);

  if (Object.keys(props).some((k) => !['amount', 'currency'].includes(k)))
    throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.UNKNOWN_MONEY_FIELD);

  try {
    return Money.from({ amount: props.amount as string, currency: props.currency as string });
  } catch (error) {
    if (error instanceof DomainError)
      throw new RequestError(HttpStatusCode.BAD_REQUEST, error.code);

    throw error;
  }
}

export function parseCommand(
  input: unknown,
  key: unknown,
  identity: ProviderIdentityPort = new DevelopmentProviderIdentity(),
): WagerCommand {
  const body = object(input);

  const allowed = [
    'providerId',
    'externalTransactionId',
    'idempotencyKey',
    'playerId',
    'walletId',
    'roundId',
    'gameId',
    'kind',
    'money',
    'referenceExternalTransactionId',
  ];

  if (Object.keys(body).some((k) => !allowed.includes(k)))
    throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.UNKNOWN_FIELD);

  const providerId = identifier(body.providerId, IdentifierField.PROVIDER);

  identity.validate(providerId);

  if (!wagerKinds.includes(body.kind as (typeof wagerKinds)[number]))
    throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.INVALID_KIND);

  const kind = body.kind as WagerCommand['kind'];
  const money = parseMoney(body.money);

  if (kind !== WagerKind.LOSS && !money.isPositive())
    throw new RequestError(HttpStatusCode.BAD_REQUEST, FinancialErrorCode.INVALID_AMOUNT);

  const reference =
    body.referenceExternalTransactionId === undefined
      ? undefined
      : identifier(body.referenceExternalTransactionId, IdentifierField.REFERENCE);

  if ((kind === WagerKind.REFUND || kind === WagerKind.ROLLBACK) && !reference)
    throw new RequestError(HttpStatusCode.BAD_REQUEST, FinancialErrorCode.REFERENCE_REQUIRED);
  if (kind === WagerKind.LOSS && reference)
    throw new RequestError(HttpStatusCode.BAD_REQUEST, ApplicationErrorCode.REFERENCE_NOT_ALLOWED);

  return {
    providerId,
    externalTransactionId: identifier(
      body.externalTransactionId,
      IdentifierField.EXTERNAL_TRANSACTION,
    ),
    idempotencyKey: identifier(key, IdentifierField.IDEMPOTENCY_KEY),
    playerId: identifier(body.playerId, IdentifierField.PLAYER, true),
    walletId: identifier(body.walletId, IdentifierField.WALLET, true),
    roundId: identifier(body.roundId, IdentifierField.ROUND),
    gameId: identifier(body.gameId, IdentifierField.GAME),
    kind,
    money: money.toJSON(),
    ...(reference ? { referenceExternalTransactionId: reference } : {}),
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;

  return JSON.stringify(value);
}

export function payloadHash(command: WagerCommand): string {
  const { idempotencyKey: _key, ...business } = command;

  return createHash('sha256').update(canonicalJson(business)).digest('hex');
}

export function newId(): string {
  return randomUUID();
}
