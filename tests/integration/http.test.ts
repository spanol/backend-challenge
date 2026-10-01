import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { createHttpApp } from '../../src/adapters/http';
import { newId } from '../../src/application/contracts';
import { requireTestIsolation } from '../helpers/isolated-environment';
import type { MoneyProps } from '../../src/domain/types/money';

interface ResponseBody {
  walletId?: string;
  transactionId?: string;
  version?: number;
  balance?: MoneyProps;
  idempotentReplay?: boolean;
  status?: string;
  items?: unknown[];
  nextCursor?: string | null;
  checkedEntries?: number;
}

let rt: Runtime;
let app: Awaited<ReturnType<typeof createHttpApp>>;
let url: string;

beforeAll(async () => {
  requireTestIsolation();
  rt = await createRuntime();
  app = await createHttpApp(rt);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

async function request(path: string, body?: unknown, key?: string) {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': 'http-integration',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return { response, body: (await response.json()) as ResponseBody };
}

test('public health, wallet, wagering, lookup, cursor, reconciliation and metrics contracts', async () => {
  expect((await request('/health/live')).response.status).toBe(200);
  expect((await request('/health/ready')).body).toMatchObject({ postgres: true, sqs: true });

  const playerId = newId();

  const w = await request('/wallets', {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });

  expect(w.response.status).toBe(201);
  expect(w.body.version).toBe(1);
  expect(w.response.headers.get('x-correlation-id')).toBe('http-integration');

  const command = {
    providerId: 'http-test',
    externalTransactionId: newId(),
    walletId: w.body.walletId,
    playerId,
    roundId: 'round',
    gameId: 'game',
    kind: 'BET',
    money: { amount: '80.00', currency: 'BRL' },
  };

  expect((await request('/wagering/transactions', command)).response.status).toBe(400);
  expect(
    (await request('/wagering/transactions', { ...command, idempotencyKey: newId() })).response
      .status,
  ).toBe(400);
  expect(
    (await request('/wagering/transactions', { ...command, kind: 'OPENING' }, newId())).response
      .status,
  ).toBe(400);

  const key = newId();
  const result = await request('/wagering/transactions', command, key);

  expect(result.response.status).toBe(200);
  expect(result.body.balance?.amount).toBe('20.00');
  expect((await request('/wagering/transactions', command, key)).body.idempotentReplay).toBe(true);
  expect(
    (
      await request(
        '/wagering/transactions',
        { ...command, money: { amount: '81.00', currency: 'BRL' } },
        key,
      )
    ).response.status,
  ).toBe(409);
  expect((await request(`/wagering/transactions/${result.body.transactionId}`)).body.status).toBe(
    'PROCESSED',
  );
  expect(
    (await request(`/providers/http-test/wagering/transactions/${command.externalTransactionId}`))
      .body.transactionId,
  ).toBe(result.body.transactionId);

  const ledger = await request(`/wallets/${w.body.walletId}/ledger?limit=1`);

  expect(ledger.body.items).toHaveLength(1);
  expect(ledger.body.nextCursor).toBeString();
  expect(
    (await request(`/wallets/${w.body.walletId}/ledger?cursor=${ledger.body.nextCursor}`)).body
      .items,
  ).toHaveLength(1);
  expect((await request(`/wallets/${w.body.walletId}/ledger?cursor=invalid`)).response.status).toBe(
    400,
  );
  expect((await request(`/wallets/${w.body.walletId}/reconciliation`, {})).body).toMatchObject({
    consistent: true,
    checkedEntries: 2,
  });
  expect((await request(`/wallets/${w.body.walletId}`)).body.balance?.amount).toBe('20.00');

  const metrics = await fetch(`${url}/metrics`);

  expect(await metrics.text()).toContain('wager_duplicates_total 1');
});

test('zero opening has no ledger and currencies have separate wallets', async () => {
  const playerId = newId();

  const brl = await request('/wallets', {
    playerId,
    initialBalance: { amount: '0.00', currency: 'BRL' },
  });

  const usd = await request('/wallets', {
    playerId,
    initialBalance: { amount: '0.00', currency: 'USD' },
  });

  expect(brl.response.status).toBe(201);
  expect(usd.response.status).toBe(201);
  expect(
    (await request(`/wallets/${brl.body.walletId}/reconciliation`, {})).body.checkedEntries,
  ).toBe(0);
  expect(
    (await request('/wallets', { playerId, initialBalance: { amount: '0.00', currency: 'BRL' } }))
      .response.status,
  ).toBe(409);
});
