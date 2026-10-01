import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHttpApp } from '../../src/adapters/http';
import { OidcProviderAuthenticator } from '../../src/adapters/oidc-authentication';
import { newId } from '../../src/application/contracts';
import { createRuntime } from '../../src/infrastructure/runtime';
import type { Runtime } from '../../src/infrastructure/types/runtime';
import { requireTestIsolation } from '../helpers/isolated-environment';

let rt: Runtime;
let app: Awaited<ReturnType<typeof createHttpApp>>;
let baseUrl: string;
let issuer: string;
let privateKey: CryptoKey;
let jwksServer: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  requireTestIsolation();

  const keys = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(keys.publicKey);

  Object.assign(publicJwk, { kid: 'local-test-key', alg: 'RS256', use: 'sig' });
  jwksServer = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/realms/test/protocol/openid-connect/certs'
        ? Response.json({ keys: [publicJwk] })
        : new Response('Not found', { status: 404 }),
  });
  issuer = `http://127.0.0.1:${jwksServer.port}/realms/test`;
  privateKey = keys.privateKey;

  const authenticator = new OidcProviderAuthenticator(
    issuer,
    'wagering-api',
    `${issuer}/protocol/openid-connect/certs`,
  );

  rt = await createRuntime();
  app = await createHttpApp(rt, authenticator);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await jwksServer?.stop(true);
});

async function token(
  options: {
    issuer?: string;
    audience?: string;
    azp?: string;
    expiresAt?: number;
  } = {},
): Promise<string> {
  const expiration = options.expiresAt ?? Math.floor(Date.now() / 1000) + 3600;

  return new SignJWT({ azp: options.azp ?? 'provider-a' })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test-key' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? 'wagering-api')
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}

async function request(path: string, bearer?: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      ...(path === '/wagering/transactions' ? { 'Idempotency-Key': newId() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return {
    response,
    body: (await response.json()) as { error?: string },
  };
}

test('health stays public while API routes require a verified bearer token', async () => {
  expect((await request('/health/live')).response.status).toBe(200);
  expect((await request('/health/ready')).response.status).toBe(200);

  const metrics = await request('/metrics');

  expect(metrics.response.status).toBe(401);
  expect(metrics.body.error).toBe('AUTHENTICATION_REQUIRED');
  expect(
    (await request('/providers/provider-a/wagering/transactions/missing')).response.status,
  ).toBe(401);
});

test.each([
  ['invalid JWT', () => Promise.resolve('not.a.jwt')],
  ['wrong issuer', () => token({ issuer: `${issuer}/other` })],
  ['wrong audience', () => token({ audience: 'another-api' })],
  ['expired token', () => token({ expiresAt: Math.floor(Date.now() / 1000) - 10 })],
  ['reserved internal provider', () => token({ azp: 'internal' })],
])('rejects %s', async (_description, makeToken) => {
  const bearer = await makeToken();
  const result = await request('/providers/provider-a/wagering/transactions/missing', bearer);

  expect(result.response.status).toBe(401);
  expect(result.body.error).toBe('INVALID_BEARER_TOKEN');
});

test('binds provider path and transaction commands to the authenticated azp', async () => {
  const bearer = await token();
  const external = await request('/providers/provider-b/wagering/transactions/missing', bearer);

  expect(external.response.status).toBe(403);
  expect(external.body.error).toBe('PROVIDER_IDENTITY_MISMATCH');

  const command = {
    providerId: 'provider-b',
    externalTransactionId: newId(),
    walletId: newId(),
    playerId: newId(),
    roundId: 'round',
    gameId: 'game',
    kind: 'BET',
    money: { amount: '1.00', currency: 'BRL' },
  };
  const transaction = await request('/wagering/transactions', bearer, command);

  expect(transaction.response.status).toBe(403);
  expect(transaction.body.error).toBe('PROVIDER_IDENTITY_MISMATCH');

  const matching = await request('/providers/provider-a/wagering/transactions/missing', bearer);

  expect(matching.response.status).toBe(404);
});
