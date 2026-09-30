import { createHash } from 'node:crypto';
import { DomainError, Money } from '../domain/money';
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
import { canonicalJson, newId, payloadHash, RequestError, systemClock } from './contracts';
import type { Clock, FaultHooks } from './types/execution';
import type { ProcessingContext, ProcessingResult, ReferenceRetryPolicy } from './types/wagering';
import type { WalletView } from './types/wallet';
import type {
  Delivery,
  FinancialSession,
  FinancialUnitOfWork,
  StoredResult,
  TransactionRecord,
} from './types/financial';

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

  private result(t: WagerTransaction, wallet: Wallet): StoredResult {
    return {
      transactionId: t.id,
      status: t.status,
      balance: wallet.balance.toJSON(),
      ...(t.failureCode ? { failureCode: t.failureCode } : {}),
    };
  }

  private async replay(
    record: TransactionRecord,
    session: FinancialSession,
  ): Promise<ProcessingResult> {
    const result =
      record.result ??
      this.result(record.transaction, (await session.wallet(record.transaction.walletId))!);

    return { ...result, idempotentReplay: true };
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
            kind: 'OPENING',
            money: balance,
            createdAt: this.clock.now(),
          });

          t.markProcessed(undefined, this.clock.now());

          const entry = WalletLedgerEntry.create({
            id: newId(),
            walletId: wallet.id,
            transactionId: t.id,
            direction: 'CREDIT',
            money: balance,
            balanceBefore: Money.zero(balance.currency),
            balanceAfter: balance,
            walletVersion: 1,
            createdAt: this.clock.now(),
          });

          await s.saveTransaction(t, this.result(t, wallet));
          s.addLedger(entry);
          this.events(s, t, wallet, ctx, entry);
        }

        await this.hooks.beforeCommit?.();
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new RequestError(409, 'WALLET_ALREADY_EXISTS');

      throw error;
    }

    await this.hooks.afterCommit?.();

    return {
      walletId: wallet.id,
      playerId,
      currency: wallet.currency,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
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
                throw new RequestError(409, 'MESSAGE_PAYLOAD_CONFLICT');

              return this.replay((await s.byId(inbox.transactionId))!, s);
            }
          }

          const existing = await s.byKey(command.idempotencyKey);

          if (existing) {
            if (!existing.transaction.matchesPayload(hash))
              throw new RequestError(409, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
            if (delivery) s.saveInbox(delivery, existing.transaction.id, this.clock.now());

            await this.hooks.beforeCommit?.();

            return this.replay(existing, s);
          }

          const wallet = await s.wallet(command.walletId, true);

          if (!wallet) throw new RequestError(404, 'WALLET_NOT_FOUND');
          if (await s.byExternal(command.providerId, command.externalTransactionId))
            throw new RequestError(409, 'EXTERNAL_TRANSACTION_CONFLICT');

          const t = WagerTransaction.create({
            ...command,
            id: newId(),
            money: Money.from(command.money),
            payloadHash: hash,
            createdAt: this.clock.now(),
          });

          await this.apply(s, t, wallet, ctx);

          const stored = this.result(t, wallet);

          await s.saveTransaction(t, stored, {
            attempts: 0,
            nextAt: new Date(this.clock.now().getTime() + retryDelay(0)),
          });
          this.events(s, t, wallet, ctx);

          if (delivery) s.saveInbox(delivery, t.id, this.clock.now());

          await this.hooks.beforeCommit?.();

          return { ...stored, idempotentReplay: false };
        },
      )
      .catch((error) => {
        if ((error as { code?: string }).code === '23505')
          throw new RequestError(409, 'EXTERNAL_TRANSACTION_CONFLICT');

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
      t.reject('PLAYER_MISMATCH');

      return;
    }
    if (wallet.currency !== t.money.currency) {
      t.reject('CURRENCY_MISMATCH');

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
        t.reject('REFERENCE_ALREADY_REVERSED');

        return;
      }
    }

    try {
      if (t.affectsBalance()) {
        const entry =
          t.ledgerDirectionFor(ref) === 'CREDIT'
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
      if (error instanceof DomainError)
        t.reject(
          error.code === 'INSUFFICIENT_FUNDS' && t.kind === 'ROLLBACK'
            ? 'REVERSAL_INSUFFICIENT_FUNDS'
            : error.code,
        );
      else throw error;
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
      t.status === 'PROCESSED'
        ? WagerTransactionProcessed
        : t.status === 'REJECTED'
          ? WagerTransactionRejected
          : t.status === 'FAILED'
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
        r.transaction.status !== 'PENDING_REFERENCE' ||
        (leaseToken && r.leaseToken !== leaseToken)
      )
        return;

      const t = r.transaction;
      const wallet = (await s.wallet(t.walletId, true))!;

      await this.apply(s, t, wallet, ctx);

      if (
        t.status === 'PENDING_REFERENCE' &&
        (this.clock.now().getTime() - t.createdAt.getTime() >= this.policy.ttlMs ||
          r.attempts + 1 >= this.policy.maxAttempts)
      )
        t.reject(
          (await s.byExternal(t.providerId, t.referenceExternalTransactionId!))
            ? 'REFERENCE_TIMEOUT'
            : 'REFERENCE_NOT_FOUND',
        );

      await s.saveTransaction(t, this.result(t, wallet), {
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
    failureCode = 'PERMANENT_INFRASTRUCTURE_FAILURE',
  ): Promise<void> {
    await this.uow.run([`idempotency:${key}`], async (s) => {
      const r = await s.byId(id);

      if (!r || r.transaction.isTerminal()) return;

      const wallet = (await s.wallet(r.transaction.walletId, true))!;

      r.transaction.fail(failureCode);
      await s.saveTransaction(r.transaction, this.result(r.transaction, wallet));
      this.events(s, r.transaction, wallet, ctx);
    });
  }
}
