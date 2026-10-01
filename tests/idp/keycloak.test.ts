import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { decodeJwt } from 'jose';
import { randomUUID } from 'node:crypto';
import { createHttpApp } from '../../src/adapters/http';
import { OidcProviderAuthenticator } from '../../src/adapters/oidc-authentication';
import { ApplicationErrorCode } from '../../src/application/constants/errors';
import { WagerKind, WagerStatus } from '../../src/domain/constants/wager';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { requireTestIsolation } from '../helpers/isolated-environment';
import { assertReconciled } from '../helpers/reconciliation';

let rt: Runtime;
let app: Awaited<ReturnType<typeof createHttpApp>>;
let base: string;
let issuer: string;
let bearer: string;
const walletIds = new Set<string>();

async function issue(clientId: string, secret = `${clientId}-e2e-only`, realmIssuer = issuer) {
  const response = await fetch(`${realmIssuer}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret,
    }),
  });

  return { status: response.status, body: (await response.json()) as { access_token?: string } };
}

async function token(clientId: string): Promise<string> {
  const result = await issue(clientId);

  expect(result.status).toBe(200);
  expect(result.body.access_token).toBeString();

  return result.body.access_token!;
}

async function request(path: string, authorization?: string, body?: unknown, key?: string) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return {
    status: response.status,
    body: (await response.json()) as {
      id?: string;
      error?: string;
      transactionId?: string;
      status?: string;
      balance?: { amount: string };
      idempotentReplay?: boolean;
      consistent?: boolean;
      storedBalance?: { amount: string };
    },
  };
}

beforeAll(async () => {
  requireTestIsolation();
  issuer = process.env.OIDC_E2E_ISSUER ?? '';

  if (!issuer || !new URL(issuer).pathname.endsWith('/realms/jungle-e2e'))
    throw new Error('Use the dedicated Keycloak E2E realm from compose.idp.yaml');

  const deadline = Date.now() + 300_000;
  let ready = false;

  while (Date.now() < deadline) {
    try {
      ready = (
        await fetch(`${issuer}/.well-known/openid-configuration`, {
          signal: AbortSignal.timeout(5000),
        })
      ).ok;
    } catch {
      ready = false;
    }

    if (ready) break;

    await Bun.sleep(1000);
  }

  if (!ready) throw new Error('Dedicated Keycloak did not become ready');

  bearer = await token('provider-a');
  rt = await createRuntime();
  app = await createHttpApp(
    rt,
    new OidcProviderAuthenticator(
      issuer,
      'wagering-api',
      `${issuer}/protocol/openid-connect/certs`,
    ),
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
}, 360_000);

afterAll(async () => {
  await app?.close();
});

afterEach(async () => {
  if (rt) await assertReconciled(rt.queries, walletIds);
});

test('real discovery and client credentials issue a signed token for the wagering audience', async () => {
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`);
  const configuration = (await discovery.json()) as { issuer: string; jwks_uri: string };
  const claims = decodeJwt(bearer);

  expect(configuration.issuer).toBe(issuer);
  expect(configuration.jwks_uri).toBe(`${issuer}/protocol/openid-connect/certs`);
  expect(claims.iss).toBe(issuer);
  expect(claims.azp).toBe('provider-a');
  expect(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).toContain('wagering-api');
  expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect((await issue('provider-a', 'incorrect-secret')).status).toBe(401);
});

test.each(['/health/live', '/health/ready'])('health remains public: %s', async (path) => {
  expect((await request(path)).status).toBe(200);
});

test.each(['/wallets/missing', '/metrics', '/providers/provider-a/wagering/transactions/missing'])(
  'protected route rejects missing credentials: %s',
  async (path) => {
    const result = await request(path);

    expect(result.status).toBe(401);
    expect(result.body.error).toBe(ApplicationErrorCode.AUTHENTICATION_REQUIRED);
  },
);

test.each(['Basic invalid', 'Bearer', 'Bearer token extra'])(
  'rejects malformed authorization: %s',
  async (authorization) => {
    const result = await request('/wallets/missing', authorization);

    expect(result.status).toBe(401);
    expect(result.body.error).toBe(ApplicationErrorCode.AUTHENTICATION_REQUIRED);
  },
);

test('rejects a tampered signature from a real issued token', async () => {
  const parts = bearer.split('.');

  parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`;

  const result = await request('/wallets/missing', `Bearer ${parts.join('.')}`);

  expect(result.status).toBe(401);
  expect(result.body.error).toBe(ApplicationErrorCode.INVALID_BEARER_TOKEN);
});

test.each(['wrong-audience', 'internal'])(
  'rejects a correctly signed Keycloak token for %s',
  async (clientId) => {
    const result = await request('/wallets/missing', `Bearer ${await token(clientId)}`);

    expect(result.status).toBe(401);
    expect(result.body.error).toBe(ApplicationErrorCode.INVALID_BEARER_TOKEN);
  },
);

test('rejects a real token issued by another Keycloak realm', async () => {
  const issued = await issue('provider-a', undefined, `${issuer}-other`);

  expect(issued.status).toBe(200);
  expect(decodeJwt(issued.body.access_token!).iss).toBe(`${issuer}-other`);

  const result = await request('/wallets/missing', `Bearer ${issued.body.access_token!}`);

  expect(result.status).toBe(401);
  expect(result.body.error).toBe(ApplicationErrorCode.INVALID_BEARER_TOKEN);
});

test('real short-lived token expires and a newly issued token restores access', async () => {
  const short = await token('short-lived');
  const claims = decodeJwt(short);
  const missingWallet = `/wallets/${randomUUID()}`;

  expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(3);
  expect((await request(missingWallet, `Bearer ${short}`)).status).toBe(404);
  await Bun.sleep(Math.max(0, claims.exp! * 1000 - Date.now() + 100));

  const expired = await request(missingWallet, `Bearer ${short}`);

  expect(expired.status).toBe(401);
  expect(expired.body.error).toBe(ApplicationErrorCode.INVALID_BEARER_TOKEN);
  expect((await request(missingWallet, `Bearer ${await token('short-lived')}`)).status).toBe(404);
});

test('authenticated financial flow, replay and provider boundaries preserve SQL effects', async () => {
  const auth = `Bearer ${bearer}`;
  const playerId = randomUUID();
  const opened = await request('/wallets', auth, {
    playerId,
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });

  expect(opened.status).toBe(201);

  const walletId = opened.body.id!;
  walletIds.add(walletId);
  const key = randomUUID();
  const command = {
    walletId,
    playerId,
    providerId: 'provider-a',
    externalTransactionId: randomUUID(),
    roundId: 'idp-e2e',
    gameId: 'idp-e2e',
    kind: WagerKind.BET,
    money: { amount: '25.00', currency: 'BRL' },
  };
  const first = await request('/wagering/transactions', auth, command, key);
  const replay = await request('/wagering/transactions', auth, command, key);

  expect(first.status).toBe(200);
  expect(first.body.status).toBe(WagerStatus.PROCESSED);
  expect(first.body.balance?.amount).toBe('75.00');
  expect(replay.body.transactionId).toBe(first.body.transactionId);
  expect(replay.body.balance?.amount).toBe('75.00');
  expect(replay.body.idempotentReplay).toBe(true);

  const otherAuth = `Bearer ${await token('provider-b')}`;
  const mismatch = await request('/wagering/transactions', otherAuth, command, key);
  const forbiddenPath = await request(
    `/providers/provider-a/wagering/transactions/${command.externalTransactionId}`,
    otherAuth,
  );

  expect(mismatch.status).toBe(403);
  expect(mismatch.body.error).toBe(ApplicationErrorCode.PROVIDER_IDENTITY_MISMATCH);
  expect(forbiddenPath.status).toBe(403);
  expect(forbiddenPath.body.error).toBe(ApplicationErrorCode.PROVIDER_IDENTITY_MISMATCH);

  const ownPath = await request(
    `/providers/provider-a/wagering/transactions/${command.externalTransactionId}`,
    auth,
  );

  expect(ownPath.status).toBe(200);
  expect(ownPath.body.transactionId).toBe(first.body.transactionId);

  const crossProviderKey = await request(
    '/wagering/transactions',
    otherAuth,
    { ...command, providerId: 'provider-b', externalTransactionId: randomUUID() },
    key,
  );

  expect(crossProviderKey.status).toBe(409);
  expect(crossProviderKey.body.error).toBe(ApplicationErrorCode.IDEMPOTENCY_PAYLOAD_CONFLICT);

  const reconciliation = await request(`/wallets/${walletId}/reconciliation`, auth, {});

  expect(reconciliation.body.consistent).toBe(true);
  expect(reconciliation.body.storedBalance?.amount).toBe('75.00');

  const rows = await rt.db.em
    .fork()
    .execute<{ ledger: string; transactions: string; journals: string; unbalanced: string }[]>(
      `SELECT
        (SELECT count(*)::text FROM wallet_ledger WHERE wallet_id=?) ledger,
        (SELECT count(*)::text FROM wager_transactions WHERE wallet_id=?) transactions,
        (SELECT count(*)::text FROM accounting_journals WHERE wallet_id=?) journals,
        (SELECT count(*)::text FROM accounting_journals j WHERE j.wallet_id=?
          AND ((SELECT count(*) FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>2
          OR (SELECT sum(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END)
              FROM accounting_journal_lines l WHERE l.journal_id=j.transaction_id)<>0)) unbalanced`,
      [walletId, walletId, walletId, walletId],
    );

  expect(rows[0]!.ledger).toBe('2');
  expect(rows[0]!.transactions).toBe('2');
  expect(rows[0]!.journals).toBe('2');
  expect(rows[0]!.unbalanced).toBe('0');
});
