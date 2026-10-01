import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { createHttpApp } from '../../src/adapters/http';
import { newId } from '../../src/application/contracts';
import { requireTestIsolation } from '../helpers/isolated-environment';
import type { MoneyProps } from '../../src/domain/types/money';
import { WageringService } from '../../src/application/wagering';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/unit-of-work';
import { connectDatabase } from '../../src/infrastructure/persistence/database';
import { assertReconciled } from '../helpers/reconciliation';

interface ResponseBody {
  id?: string;
  walletId?: string;
  transactionId?: string;
  version?: number;
  balance?: MoneyProps;
  idempotentReplay?: boolean;
  status?: string;
  failureCode?: string;
  error?: string;
  items?: unknown[];
  nextCursor?: string | null;
  checkedEntries?: number;
  postings?: Array<{
    accountType: string;
    accountId: string | null;
    direction: string;
    amount: string;
    currency: string;
  }>;
}

let rt: Runtime;
let app: Awaited<ReturnType<typeof createHttpApp>>;
let url: string;
const walletIds = new Set<string>();

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

afterEach(async () => {
  await assertReconciled(rt.queries, walletIds);
  walletIds.clear();
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

  const parsed = (await response.json()) as ResponseBody;

  if (path === '/wallets' && response.status === 201) walletIds.add(parsed.id!);

  return { response, body: parsed };
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
  expect(w.body.id).toBeString();
  expect(w.body.walletId).toBeUndefined();
  expect(w.body.version).toBe(1);
  expect(w.response.headers.get('x-correlation-id')).toBe('http-integration');

  const command = {
    providerId: 'http-test',
    externalTransactionId: newId(),
    walletId: w.body.id!,
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

  const ledger = await request(`/wallets/${w.body.id}/ledger?limit=1`);

  expect(ledger.body.items).toHaveLength(1);
  expect(ledger.body.nextCursor).toBeString();
  expect(
    (await request(`/wallets/${w.body.id}/ledger?cursor=${ledger.body.nextCursor}`)).body.items,
  ).toHaveLength(1);
  expect((await request(`/wallets/${w.body.id}/ledger?cursor=invalid`)).response.status).toBe(400);
  expect((await request(`/wallets/${w.body.id}/reconciliation`, {})).body).toMatchObject({
    consistent: true,
    checkedEntries: 2,
  });
  expect((await request(`/wallets/${w.body.id}`)).body.balance?.amount).toBe('20.00');

  const metrics = await fetch(`${url}/metrics`);
  const exposition = await metrics.text();

  expect(exposition).toContain('wager_duplicates_total 1');
  expect(exposition).toContain('wager_http_responses_total{status_code="200"} 2');
  expect(exposition).toContain('wager_http_responses_total{status_code="400"} 3');
  expect(exposition).toContain('wager_http_responses_total{status_code="409"} 1');

  for (const name of [
    'process_cpu_seconds_total',
    'process_resident_memory_bytes',
    'nodejs_heap_size_used_bytes',
    'nodejs_eventloop_lag_p99_seconds',
    'wager_outbox_pending',
    'wager_telemetry_timestamp_seconds',
    'wager_request_queue_visible',
    'wager_request_queue_inflight',
    'wager_request_queue_delayed',
  ]) {
    expect(exposition).toContain(`# HELP ${name} `);
  }
});

test('HTTP 202 pending, 422 business rejection and 503 terminal failure preserve financial state', async () => {
  const playerId = newId();
  const wallet = await request('/wallets', {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  const command = {
    providerId: 'http-status',
    externalTransactionId: newId(),
    walletId: wallet.body.id!,
    playerId,
    roundId: 'round',
    gameId: 'game',
    kind: 'REFUND',
    money: { amount: '25.00', currency: 'BRL' },
    referenceExternalTransactionId: newId(),
  };
  const key = newId();
  const pending = await request('/wagering/transactions', command, key);

  expect(pending.response.status).toBe(202);
  expect(pending.body).toMatchObject({
    status: 'PENDING_REFERENCE',
    balance: { amount: '100.00', currency: 'BRL' },
    idempotentReplay: false,
  });
  expect((await request('/wagering/transactions', command, key)).body.idempotentReplay).toBe(true);

  const rejected = await request(
    '/wagering/transactions',
    {
      ...command,
      externalTransactionId: newId(),
      kind: 'BET',
      money: { amount: '101.00', currency: 'BRL' },
      referenceExternalTransactionId: undefined,
    },
    newId(),
  );

  expect(rejected.response.status).toBe(422);
  expect(rejected.body).toMatchObject({
    status: 'REJECTED',
    failureCode: 'INSUFFICIENT_FUNDS',
    balance: { amount: '100.00', currency: 'BRL' },
  });

  await rt.service.failAccepted(pending.body.transactionId!, key, { correlationId: 'http-status' });

  const failed = await request('/wagering/transactions', command, key);

  expect(failed.response.status).toBe(503);
  expect(failed.body).toMatchObject({
    status: 'FAILED',
    failureCode: 'PERMANENT_INFRASTRUCTURE_FAILURE',
    idempotentReplay: true,
    balance: { amount: '100.00', currency: 'BRL' },
  });
  expect(await rt.queries.wallet(wallet.body.id!)).toMatchObject({
    version: 1,
    balance: { amount: '100.00', currency: 'BRL' },
  });
  expect((await rt.queries.reconciliation(wallet.body.id!)).checkedEntries).toBe(1);

  const exposition = await (await fetch(`${url}/metrics`)).text();

  expect(exposition).toContain('wager_http_responses_total{status_code="202"} 2');
  expect(exposition).toContain('wager_http_responses_total{status_code="422"} 1');
  expect(exposition).toContain('wager_http_responses_total{status_code="503"} 1');
});

test('accounting journals mirror opening and wager ledgers, ignore non-movements and stay immutable', async () => {
  const playerId = newId();
  const wallet = await request('/wallets', {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  const betCommand = {
    providerId: 'accounting-test',
    externalTransactionId: newId(),
    walletId: wallet.body.id!,
    playerId,
    roundId: 'round',
    gameId: 'game',
    kind: 'BET',
    money: { amount: '30.00', currency: 'BRL' },
  };
  const betKey = newId();
  const bet = await request('/wagering/transactions', betCommand, betKey);
  const replay = await request('/wagering/transactions', betCommand, betKey);
  const betJournal = await request(
    `/wagering/transactions/${bet.body.transactionId}/accounting-journal`,
  );

  expect(bet.response.status).toBe(200);
  expect(replay.body.idempotentReplay).toBe(true);
  expect(betJournal.body.postings).toEqual([
    {
      accountType: 'WALLET_LIABILITY',
      accountId: wallet.body.id!,
      direction: 'DEBIT',
      amount: '30.00',
      currency: 'BRL',
    },
    {
      accountType: 'PLATFORM_CLEARING',
      accountId: null,
      direction: 'CREDIT',
      amount: '30.00',
      currency: 'BRL',
    },
  ]);

  const loss = await request(
    '/wagering/transactions',
    {
      ...betCommand,
      externalTransactionId: newId(),
      kind: 'LOSS',
      money: { amount: '0.00', currency: 'BRL' },
    },
    newId(),
  );
  const rejection = await request(
    '/wagering/transactions',
    {
      ...betCommand,
      externalTransactionId: newId(),
      money: { amount: '1000.00', currency: 'BRL' },
    },
    newId(),
  );

  expect(loss.response.status).toBe(200);
  expect(rejection.response.status).toBe(422);
  expect(
    (await request(`/wagering/transactions/${loss.body.transactionId}/accounting-journal`)).body
      .postings,
  ).toEqual([]);
  expect(
    (await request(`/wagering/transactions/${rejection.body.transactionId}/accounting-journal`))
      .body.postings,
  ).toEqual([]);

  const opening = await rt.db.em
    .fork()
    .execute<{ transaction_id: string }[]>(
      'SELECT transaction_id FROM wallet_ledger WHERE wallet_id=? AND wallet_version=1',
      [wallet.body.id],
    );
  const openingJournal = await request(
    `/wagering/transactions/${opening[0]!.transaction_id}/accounting-journal`,
  );
  const journals = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT COUNT(*)::text count FROM accounting_journals WHERE wallet_id=?',
      [wallet.body.id],
    );

  expect(openingJournal.body.postings).toEqual([
    {
      accountType: 'WALLET_LIABILITY',
      accountId: wallet.body.id!,
      direction: 'CREDIT',
      amount: '100.00',
      currency: 'BRL',
    },
    {
      accountType: 'PLATFORM_CLEARING',
      accountId: null,
      direction: 'DEBIT',
      amount: '100.00',
      currency: 'BRL',
    },
  ]);
  expect(journals[0]!.count).toBe('2');

  // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun 1.4.2 types rejects matchers as void; runtime must await them.
  await expect(
    rt.db.em
      .fork()
      .execute(
        'UPDATE accounting_journal_lines SET amount=? WHERE journal_id=? AND line_number=1',
        ['31.00', bet.body.transactionId],
      ),
  ).rejects.toThrow();
  // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun 1.4.2 types rejects matchers as void; runtime must await them.
  await expect(
    rt.db.em
      .fork()
      .execute('DELETE FROM accounting_journals WHERE transaction_id=?', [bet.body.transactionId]),
  ).rejects.toThrow();
  // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun 1.4.2 types rejects matchers as void; runtime must await them.
  await expect(rt.db.em.fork().execute('TRUNCATE accounting_journal_lines')).rejects.toThrow();

  // eslint-disable-next-line @typescript-eslint/await-thenable -- Bun 1.4.2 types rejects matchers as void; runtime must await them.
  await expect(
    rt.db.em.fork().transactional(async (em) => {
      await em.execute(
        'INSERT INTO accounting_journals(transaction_id,wallet_id,currency,created_at) VALUES (?,?,?,now())',
        [loss.body.transactionId, wallet.body.id, 'BRL'],
      );
      await em.execute(
        'INSERT INTO accounting_journal_lines(journal_id,line_number,account_type,account_id,direction,amount,currency) VALUES (?,?,?,?,?,?,?)',
        [loss.body.transactionId, 1, 'WALLET_LIABILITY', wallet.body.id, 'CREDIT', '0.01', 'BRL'],
      );
      await em.execute(
        'INSERT INTO accounting_journal_lines(journal_id,line_number,account_type,account_id,direction,amount,currency) VALUES (?,?,?,?,?,?,?)',
        [loss.body.transactionId, 2, 'PLATFORM_CLEARING', null, 'DEBIT', '0.01', 'BRL'],
      );
    }),
  ).rejects.toThrow();

  const finalCount = await rt.db.em
    .fork()
    .execute<{ count: string }[]>(
      'SELECT COUNT(*)::text count FROM accounting_journals WHERE wallet_id=?',
      [wallet.body.id],
    );

  expect(finalCount[0]!.count).toBe('2');
});

test('transient pre-commit HTTP failure returns 503 and leaves the command retryable', async () => {
  const playerId = newId();
  const wallet = await request('/wallets', {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  const command = {
    providerId: 'http-transient',
    externalTransactionId: newId(),
    walletId: wallet.body.id!,
    playerId,
    roundId: 'round',
    gameId: 'game',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
  };
  const original = rt.service;
  const key = newId();

  try {
    rt.service = new WageringService(new MikroFinancialUnitOfWork(rt.db), undefined, {
      beforeCommit: () => {
        throw new Error('injected transient infrastructure failure');
      },
    });

    const failed = await request('/wagering/transactions', command, key);

    expect(failed.response.status).toBe(503);
    expect(failed.body.error).toBe('SERVICE_UNAVAILABLE');
    expect(await rt.queries.byKey(key)).toBeNull();
    expect((await rt.queries.wallet(wallet.body.id!)).balance.amount).toBe('100.00');
    expect((await rt.queries.reconciliation(wallet.body.id!)).checkedEntries).toBe(1);
  } finally {
    rt.service = original;
  }

  expect((await request('/wagering/transactions', command, key)).response.status).toBe(200);
  expect((await rt.queries.wallet(wallet.body.id!)).balance.amount).toBe('75.00');
});

test('readiness reports a real unavailable SQL connection or missing SQS queue and recovers', async () => {
  const originalDb = rt.db;
  const originalEvents = rt.queues.events;
  const unavailableDb = await connectDatabase();

  await unavailableDb.close(true);

  try {
    rt.db = unavailableDb;

    const sqlUnavailable = await request('/health/ready');

    expect(sqlUnavailable.response.status).toBe(503);
    expect(sqlUnavailable.body).toMatchObject({
      status: 'unavailable',
      postgres: false,
      sqs: true,
    });
    expect((await request('/health/live')).response.status).toBe(200);

    rt.db = originalDb;
    rt.queues.events = originalEvents.replace(
      /[^/]+$/,
      `${process.env.TEST_RESOURCE_ID}-missing-${newId()}.fifo`,
    );

    const sqsUnavailable = await request('/health/ready');

    expect(sqsUnavailable.response.status).toBe(503);
    expect(sqsUnavailable.body).toMatchObject({
      status: 'unavailable',
      postgres: true,
      sqs: false,
    });
    expect((await request('/health/live')).response.status).toBe(200);
  } finally {
    rt.db = originalDb;
    rt.queues.events = originalEvents;
  }

  const recovered = await request('/health/ready');

  expect(recovered.response.status).toBe(200);
  expect(recovered.body).toMatchObject({ status: 'ok', postgres: true, sqs: true });
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
  expect((await request(`/wallets/${brl.body.id}/reconciliation`, {})).body.checkedEntries).toBe(0);
  expect(
    (await request('/wallets', { playerId, initialBalance: { amount: '0.00', currency: 'BRL' } }))
      .response.status,
  ).toBe(409);
});
