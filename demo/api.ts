import { WagerStatus } from '../src/domain/constants/wager';
import { newId, object } from '../src/application/contracts';
import type { WalletView } from '../src/application/types/wallet';
import type { ProcessingResult } from '../src/application/types/wagering';
import type { WagerCommand } from '../src/domain/types/wager';
import { Money } from '../src/domain/money';
import type { Evidence, FinancialApi } from './types/contracts';

export class HttpFinancialApi implements FinancialApi {
  private index = 0;
  private readonly initialBalance: string;
  readonly urls: string[];

  constructor(urls: string[], options: { initialBalance?: string } = {}) {
    if (!urls.length) throw new Error('Configure ao menos uma API financeira');

    const initialBalance = Money.from({
      amount: options.initialBalance ?? '100.00',
      currency: 'BRL',
    });
    if (!initialBalance.isPositive()) throw new Error('Saldo inicial da demo deve ser positivo');
    this.initialBalance = initialBalance.toString();

    this.urls = urls.map((input) => {
      const url = new URL(input);

      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error('URL de API inválida');

      return url.origin;
    });
  }

  private next(): string {
    return this.urls[this.index++ % this.urls.length]!;
  }

  private async request(api: string, path: string, body?: unknown, key?: string) {
    const response = await fetch(`${api}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    });
    let data: Record<string, unknown>;
    try {
      data = object((await response.json()) as unknown);
    } catch {
      // A proxy error may be text/HTML. Preserve uncertainty and the HTTP status;
      // it is never a terminal financial result or permission to change identity.
      throw new Error(
        `API financeira indisponível ou resposta inválida (HTTP ${response.status}).`,
      );
    }

    return { status: response.status, data };
  }

  async openWallet(): Promise<WalletView> {
    const { status, data } = await this.request(this.next(), '/wallets', {
      playerId: newId(),
      initialBalance: { amount: this.initialBalance, currency: 'BRL' },
    });

    if (status !== 201 || typeof data.id !== 'string')
      throw new Error(`Abertura da carteira falhou (${status})`);

    const { id, ...wallet } = data;

    return { ...wallet, walletId: id } as unknown as WalletView;
  }

  async process(command: WagerCommand) {
    const api = this.next();
    const { idempotencyKey, ...body } = command;
    const { status, data } = await this.request(
      api,
      '/wagering/transactions',
      body,
      idempotencyKey,
    );

    if (
      ![200, 202, 422, 503].includes(status) ||
      typeof data.transactionId !== 'string' ||
      ![
        WagerStatus.PROCESSED,
        WagerStatus.REJECTED,
        WagerStatus.FAILED,
        WagerStatus.PENDING_REFERENCE,
      ].some((status) => status === data.status)
    )
      throw new Error(`API financeira indisponível ou contrato recusado (${status})`);

    return { api, result: data as unknown as ProcessingResult };
  }

  async inspect(walletId: string, cursor?: string): Promise<Evidence> {
    const api = this.next();
    const path = `/wallets/${encodeURIComponent(walletId)}`;
    const responses = await Promise.all([
      this.request(api, path),
      this.request(
        api,
        `${path}/ledger?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
      this.request(api, `${path}/reconciliation`, {}),
    ]);

    if (responses.some((r) => r.status !== 200))
      throw new Error('Consulta financeira indisponível');

    return {
      wallet: responses[0].data,
      ledger: responses[1].data,
      reconciliation: responses[2].data,
    } as unknown as Evidence;
  }

  async conflict(command: WagerCommand): Promise<number> {
    const { idempotencyKey, ...body } = command;
    const money = Money.from(command.money)
      .add(Money.from({ amount: '0.01', currency: command.money.currency }))
      .toJSON();

    return (
      await this.request(this.next(), '/wagering/transactions', { ...body, money }, idempotencyKey)
    ).status;
  }
}
