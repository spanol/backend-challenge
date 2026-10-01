import { createHash } from 'node:crypto';
import { DomainError, Money } from '../domain/money';
import { FinancialErrorCode, type WagerFailureCode } from '../domain/constants/errors';
import { WagerKind, WagerStatus } from '../domain/constants/wager';
import { LedgerDirection } from '../domain/constants/wallet';
import { Wallet, WalletLedgerEntry } from '../domain/wallet';
import { WagerTransaction } from '../domain/wager';
import type { WagerCommand } from '../domain/types/wager';
import { retryDelay } from '../domain/messages';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WagerTransactionFailed,
} from '../domain/events';
import type { EventContext } from '../domain/types/events';
import {
  canonicalJson,
  newId,
  payloadHash,
  PersistenceError,
  RequestError,
  systemClock,
} from './contracts';
import { ApplicationErrorCode } from './constants/errors';
import { HttpStatusCode } from './constants/http-status';
import { toPublicProcessingResult, toStoredResult } from './mappers/wager-result.mapper';
import { toWalletView } from './mappers/wallet-view.mapper';
import type { Clock, FaultHooks } from './types/execution';
import type { ProcessingContext, ProcessingResult, ReferenceRetryPolicy } from './types/wagering';
import type { WalletView } from './types/wallet';
import type {
  Delivery,
  FinancialSession,
  FinancialUnitOfWork,
  TransactionRecord,
} from './types/financial';

function movementFailureCode(error: DomainError, kind: WagerKind): WagerFailureCode | undefined {
  switch (error.code) {
    case FinancialErrorCode.INSUFFICIENT_FUNDS:
      return kind === WagerKind.ROLLBACK
        ? FinancialErrorCode.REVERSAL_INSUFFICIENT_FUNDS
        : FinancialErrorCode.INSUFFICIENT_FUNDS;
    case FinancialErrorCode.INVALID_AMOUNT:
    case FinancialErrorCode.AMOUNT_LIMIT_EXCEEDED:
    case FinancialErrorCode.CURRENCY_MISMATCH:
      return error.code;
    default:
      return undefined;
  }
}

export class WageringService {
  constructor(
    private readonly uow: FinancialUnitOfWork,
    private readonly clock: Clock = systemClock,
    private readonly hooks: FaultHooks = {},
    private readonly policy: ReferenceRetryPolicy = { ttlMs: 900_000, maxAttempts: 20 },
  ) {}

  private context(walletId: string, ctx: ProcessingContext): EventContext {
    return {
      eventId: newId(),
      aggregateId: walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.messageId,
      occurredAt: this.clock.now(),
    };
  }

  private async replay(
    record: TransactionRecord,
    session: FinancialSession,
  ): Promise<ProcessingResult> {
    const result =
      record.result ??
      toStoredResult(record.transaction, (await session.wallet(record.transaction.walletId))!);

    return { ...toPublicProcessingResult(result), idempotentReplay: true };
  }

  async openWallet(playerId: string, balance: Money, ctx: ProcessingContext): Promise<WalletView> {
    const wallet = Wallet.open({
      id: newId(),
      playerId,
      initialBalance: balance,
      at: this.clock.now(),
    });

    try {
      await this.uow.run([`wallet-opening:${playerId}:${balance.currency}`], async (s) => {
        await s.saveWallet(wallet);

        if (!balance.isZero()) {
          const t = WagerTransaction.create({
            id: newId(),
            providerId: 'internal',
            externalTransactionId: `opening:${wallet.id}`,
            idempotencyKey: `opening:${wallet.id}`,
            payloadHash: createHash('sha256').update(wallet.id).digest('hex'),
            walletId: wallet.id,
            playerId,
            roundId: 'opening',
            gameId: 'opening',
            kind: WagerKind.OPENING,
            money: balance,
            createdAt: this.clock.now(),
          });

          t.markProcessed(undefined, this.clock.now());

          const entry = WalletLedgerEntry.create({
            id: newId(),
            walletId: wallet.id,
            transactionId: t.id,
            direction: LedgerDirection.CREDIT,
            money: balance,
            balanceBefore: Money.zero(balance.currency),
            balanceAfter: balance,
            walletVersion: 1,
            createdAt: this.clock.now(),
          });

          await s.saveTransaction(t, toStoredResult(t, wallet));
          s.addLedger(entry);
          this.events(s, t, wallet, ctx, entry);
        }

        await this.hooks.beforeCommit?.();
      });
    } catch (error) {
      if (error instanceof PersistenceError)
        throw new RequestError(HttpStatusCode.CONFLICT, ApplicationErrorCode.WALLET_ALREADY_EXISTS);

      throw error;
    }

    await this.hooks.afterCommit?.();

    return toWalletView({
      walletId: wallet.id,
      playerId,
      currency: wallet.currency,
      balance: wallet.balance,
      version: wallet.version,
    });
  }

  async process(command: WagerCommand, ctx: ProcessingContext): Promise<ProcessingResult> {
    const hash = payloadHash(command);

    const delivery: Delivery | undefined =
      ctx.messageId && ctx.consumerName
        ? {
            messageId: ctx.messageId,
            consumerName: ctx.consumerName,
            payloadHash: createHash('sha256').update(canonicalJson(command)).digest('hex'),
          }
        : undefined;

    const result = await this.uow
      .run(
        [
          ...(delivery ? [`inbox:${delivery.consumerName}:${delivery.messageId}`] : []),
          `idempotency:${command.idempotencyKey}`,
        ],
        async (s) => {
          if (delivery) {
            const inbox = await s.inbox(delivery);

            if (inbox) {
              if (inbox.payloadHash !== delivery.payloadHash)
                throw new RequestError(
                  HttpStatusCode.CONFLICT,
                  ApplicationErrorCode.MESSAGE_PAYLOAD_CONFLICT,
                );

              return this.replay((await s.byId(inbox.transactionId))!, s);
            }
          }

          const existing = await s.byKey(command.idempotencyKey);

          if (existing) {
            if (!existing.transaction.matchesPayload(hash))
              throw new RequestError(
                HttpStatusCode.CONFLICT,
                ApplicationErrorCode.IDEMPOTENCY_PAYLOAD_CONFLICT,
              );
            if (delivery) s.saveInbox(delivery, existing.transaction.id, this.clock.now());

            await this.hooks.beforeCommit?.();

            return this.replay(existing, s);
          }

          const wallet = await s.wallet(command.walletId, true);

          if (!wallet)
            throw new RequestError(HttpStatusCode.NOT_FOUND, ApplicationErrorCode.WALLET_NOT_FOUND);
          if (await s.byExternal(command.providerId, command.externalTransactionId))
            throw new RequestError(
              HttpStatusCode.CONFLICT,
              ApplicationErrorCode.EXTERNAL_TRANSACTION_CONFLICT,
            );

          const t = WagerTransaction.create({
            ...command,
            id: newId(),
            money: Money.from(command.money),
            payloadHash: hash,
            createdAt: this.clock.now(),
          });

          await this.apply(s, t, wallet, ctx);

          const stored = toStoredResult(t, wallet);

          await s.saveTransaction(t, stored, {
            attempts: 0,
            nextAt: new Date(this.clock.now().getTime() + retryDelay(0)),
          });
          this.events(s, t, wallet, ctx);

          if (delivery) s.saveInbox(delivery, t.id, this.clock.now());

          await this.hooks.beforeCommit?.();

          return { ...toPublicProcessingResult(stored), idempotentReplay: false };
        },
      )
      .catch((error) => {
        if (error instanceof PersistenceError)
          throw new RequestError(
            HttpStatusCode.CONFLICT,
            ApplicationErrorCode.EXTERNAL_TRANSACTION_CONFLICT,
          );

        throw error;
      });

    await this.hooks.afterCommit?.();

    return result;
  }

  private async apply(
    s: FinancialSession,
    t: WagerTransaction,
    wallet: Wallet,
    ctx: ProcessingContext,
  ): Promise<void> {
    if (wallet.playerId !== t.playerId) {
      t.reject(FinancialErrorCode.PLAYER_MISMATCH);

      return;
    }
    if (wallet.currency !== t.money.currency) {
      t.reject(FinancialErrorCode.CURRENCY_MISMATCH);

      return;
    }

    let ref: WagerTransaction | undefined;

    if (t.referenceExternalTransactionId) {
      ref = (await s.byExternal(t.providerId, t.referenceExternalTransactionId))?.transaction;

      if (!ref) {
        t.markPendingReference();

        return;
      }

      const failure = t.validateReference(ref);

      if (failure) {
        t.reject(failure);

        return;
      }
      if (!ref.isTerminal()) {
        t.markPendingReference();

        return;
      }
      if (t.requiresReference() && (await s.reversalOf(ref.id))) {
        t.reject(FinancialErrorCode.REFERENCE_ALREADY_REVERSED);

        return;
      }
    }

    try {
      if (t.affectsBalance()) {
        const entry =
          t.ledgerDirectionFor(ref) === LedgerDirection.CREDIT
            ? wallet.credit(t.money, t.id, newId(), this.clock.now())
            : wallet.debit(t.money, t.id, newId(), this.clock.now());

        s.addLedger(entry);
        await s.saveWallet(wallet);
        s.addEvent(
          WalletBalanceChanged.from(this.context(wallet.id, ctx), {
            walletId: wallet.id,
            transactionId: t.id,
            direction: entry.direction,
            money: entry.money.toJSON(),
            balanceBefore: entry.balanceBefore.toJSON(),
            balanceAfter: entry.balanceAfter.toJSON(),
            walletVersion: wallet.version,
          }),
        );
      }

      t.markProcessed(ref?.id, this.clock.now());
    } catch (error) {
      if (error instanceof DomainError) {
        const failureCode = movementFailureCode(error, t.kind);

        if (failureCode) t.reject(failureCode);
        else throw error;
      } else throw error;
    }
  }

  private events(
    s: FinancialSession,
    t: WagerTransaction,
    wallet: Wallet,
    ctx: ProcessingContext,
    opening?: WalletLedgerEntry,
  ): void {
    const data = {
      transactionId: t.id,
      providerId: t.providerId,
      status: t.status,
      failureCode: t.failureCode,
      balance: wallet.balance.toJSON(),
    };

    const eventContext = this.context(wallet.id, ctx);

    const Event =
      t.status === WagerStatus.PROCESSED
        ? WagerTransactionProcessed
        : t.status === WagerStatus.REJECTED
          ? WagerTransactionRejected
          : t.status === WagerStatus.FAILED
            ? WagerTransactionFailed
            : WagerTransactionPendingReference;

    s.addEvent(Event.from(eventContext, data));

    if (opening)
      s.addEvent(
        WalletBalanceChanged.from(this.context(wallet.id, ctx), {
          walletId: wallet.id,
          transactionId: t.id,
          direction: opening.direction,
          money: opening.money.toJSON(),
          balanceBefore: opening.balanceBefore.toJSON(),
          balanceAfter: opening.balanceAfter.toJSON(),
          walletVersion: wallet.version,
        }),
      );
  }

  async retryReference(
    id: string,
    key: string,
    ctx: ProcessingContext,
    leaseToken?: string,
  ): Promise<void> {
    await this.uow.run([`idempotency:${key}`], async (s) => {
      const r = await s.byId(id);

      if (
        !r ||
        r.transaction.status !== WagerStatus.PENDING_REFERENCE ||
        (leaseToken && r.leaseToken !== leaseToken)
      )
        return;

      const t = r.transaction;
      const wallet = (await s.wallet(t.walletId, true))!;

      await this.apply(s, t, wallet, ctx);

      if (
        t.status === WagerStatus.PENDING_REFERENCE &&
        (this.clock.now().getTime() - t.createdAt.getTime() >= this.policy.ttlMs ||
          r.attempts + 1 >= this.policy.maxAttempts)
      )
        t.reject(
          (await s.byExternal(t.providerId, t.referenceExternalTransactionId!))
            ? FinancialErrorCode.REFERENCE_TIMEOUT
            : FinancialErrorCode.REFERENCE_NOT_FOUND,
        );

      await s.saveTransaction(t, toStoredResult(t, wallet), {
        attempts: r.attempts + 1,
        nextAt: new Date(this.clock.now().getTime() + retryDelay(r.attempts + 1)),
      });

      if (t.isTerminal()) this.events(s, t, wallet, ctx);

      await this.hooks.beforeCommit?.();
    });
    await this.hooks.afterCommit?.();
  }

  async failAccepted(
    id: string,
    key: string,
    ctx: ProcessingContext,
    failureCode: WagerFailureCode = FinancialErrorCode.PERMANENT_INFRASTRUCTURE_FAILURE,
  ): Promise<void> {
    await this.uow.run([`idempotency:${key}`], async (s) => {
      const r = await s.byId(id);

      if (!r || r.transaction.isTerminal()) return;

      const wallet = (await s.wallet(r.transaction.walletId, true))!;

      r.transaction.fail(failureCode);
      await s.saveTransaction(r.transaction, toStoredResult(r.transaction, wallet));
      this.events(s, r.transaction, wallet, ctx);
    });
  }
}
