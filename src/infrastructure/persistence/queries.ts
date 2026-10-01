import { Money } from '../../domain/money';
import { object, RequestError } from '../../application/contracts';
import { toWalletView } from '../../application/mappers/wallet-view.mapper';
import type { Database } from './types/database';
import { WalletRow, TransactionRow, LedgerRow } from './entities';
import type { WalletView } from '../../application/types/wallet';
import type { ReconciliationRow, ReconciliationDivergence } from './types/queries';

export class WageringQueries {
  constructor(
    private readonly db: Database,
    private readonly onDivergence: (context: ReconciliationDivergence) => void = () => undefined,
  ) {}

  async wallet(id: string): Promise<WalletView> {
    const w = await this.db.em.fork().findOne(WalletRow, { id });

    if (!w) throw new RequestError(404, 'WALLET_NOT_FOUND');

    return toWalletView({
      walletId: w.id,
      playerId: w.playerId,
      currency: w.currency,
      balance: Money.from({ amount: w.balance, currency: w.currency }),
      version: w.version,
    });
  }

  async transaction(id: string) {
    return this.transactionView(await this.db.em.fork().findOne(TransactionRow, { id }));
  }

  async external(providerId: string, externalTransactionId: string) {
    return this.transactionView(
      await this.db.em.fork().findOne(TransactionRow, { providerId, externalTransactionId }),
    );
  }

  async byKey(idempotencyKey: string) {
    return this.db.em.fork().findOne(TransactionRow, { idempotencyKey });
  }

  private async transactionView(t: TransactionRow | null) {
    if (!t) throw new RequestError(404, 'TRANSACTION_NOT_FOUND');

    const balance = t.result?.balance ?? (await this.wallet(t.walletId)).balance;

    return {
      transactionId: t.id,
      providerId: t.providerId,
      externalTransactionId: t.externalTransactionId,
      walletId: t.walletId,
      playerId: t.playerId,
      roundId: t.roundId,
      gameId: t.gameId,
      kind: t.kind,
      money: { amount: t.amount, currency: t.currency },
      status: t.status,
      balance,
      failureCode: t.failureCode,
      referenceExternalTransactionId: t.referenceExternalTransactionId,
      referenceTransactionId: t.referenceTransactionId,
      createdAt: t.createdAt.toISOString(),
      processedAt: t.processedAt?.toISOString(),
    };
  }

  async ledger(walletId: string, cursor?: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RequestError(400, 'INVALID_LIMIT');

    await this.wallet(walletId);

    let version = 0;

    if (cursor) {
      try {
        const decoded = object(JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown);

        if (
          decoded.v !== 1 ||
          decoded.walletId !== walletId ||
          typeof decoded.version !== 'number' ||
          !Number.isSafeInteger(decoded.version) ||
          decoded.version < 1
        )
          throw new Error();

        version = decoded.version;
      } catch {
        throw new RequestError(400, 'INVALID_CURSOR');
      }
    }

    const rows = await this.db.em
      .fork()
      .find(
        LedgerRow,
        { walletId, walletVersion: { $gt: version } },
        { orderBy: { walletVersion: 'ASC' }, limit: limit + 1 },
      );

    const page = rows.slice(0, limit);

    return {
      items: page.map((l) => ({
        ledgerEntryId: l.id,
        walletId,
        transactionId: l.transactionId,
        direction: l.direction,
        money: { amount: l.amount, currency: l.currency },
        balanceBefore: { amount: l.balanceBefore, currency: l.currency },
        balanceAfter: { amount: l.balanceAfter, currency: l.currency },
        walletVersion: l.walletVersion,
        createdAt: l.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({ v: 1, walletId, version: page.at(-1)!.walletVersion }),
            ).toString('base64url')
          : null,
    };
  }

  async reconciliation(walletId: string) {
    // One SQL statement means one MVCC snapshot, even while another process commits a wager.
    const rows = await this.db.em.fork().execute<ReconciliationRow[]>(
      `
      SELECT w.balance::text,w.currency,COALESCE(l.calculated,0)::numeric(20,2)::text calculated,COALESCE(l.entries,0)::text entries
      FROM wallets w LEFT JOIN LATERAL (SELECT SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END) calculated,COUNT(*) entries FROM wallet_ledger WHERE wallet_id=w.id) l ON true WHERE w.id=?`,
      [walletId],
    );

    const row = rows[0];

    if (!row) throw new RequestError(404, 'WALLET_NOT_FOUND');

    const stored = Money.from({ amount: row.balance, currency: row.currency });

    const calculated = row.calculated.startsWith('-')
      ? Money.from({ amount: row.calculated.slice(1), currency: row.currency }).negate()
      : Money.from({ amount: row.calculated, currency: row.currency });

    const result = {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: stored.subtract(calculated).toJSON(),
      consistent: stored.equals(calculated),
      checkedEntries: Number(row.entries),
    };

    if (!result.consistent) this.onDivergence({ walletId, checkedEntries: result.checkedEntries });

    return result;
  }
}
