import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApplicationErrorCode } from '../application/constants/errors';
import { RequestError } from '../application/contracts';
import { HttpStatusCode } from '../application/constants/http-status';
import type { HttpRequest } from './types/http';

const providerIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;

export class OidcProviderAuthenticator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly issuer: string,
    private readonly audience: string,
    jwksUri: string,
  ) {
    const issuerUrl = new URL(issuer);
    const jwksUrl = new URL(jwksUri);

    if (
      !['http:', 'https:'].includes(issuerUrl.protocol) ||
      jwksUrl.origin !== issuerUrl.origin ||
      !jwksUrl.pathname.startsWith(`${issuerUrl.pathname.replace(/\/$/, '')}/`)
    )
      throw new Error(ApplicationErrorCode.AUTH_CONFIGURATION_INVALID);

    this.jwks = createRemoteJWKSet(jwksUrl);
  }

  async authenticate(authorization: string | string[] | undefined): Promise<string> {
    if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/i.test(authorization))
      throw new RequestError(
        HttpStatusCode.UNAUTHORIZED,
        ApplicationErrorCode.AUTHENTICATION_REQUIRED,
      );

    const token = authorization.slice('Bearer '.length);

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
      });
      const providerId = payload.azp;

      if (
        typeof providerId !== 'string' ||
        !providerIdPattern.test(providerId) ||
        providerId === 'internal'
      )
        throw new Error(ApplicationErrorCode.INVALID_BEARER_TOKEN);

      return providerId;
    } catch {
      throw new RequestError(
        HttpStatusCode.UNAUTHORIZED,
        ApplicationErrorCode.INVALID_BEARER_TOKEN,
      );
    }
  }
}

export class OptionalOidcGuard implements CanActivate {
  constructor(private readonly authenticator: OidcProviderAuthenticator | undefined) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();

    if (!this.authenticator || request.path?.startsWith('/health/')) return true;

    request.authenticatedProviderId = await this.authenticator.authenticate(
      request.headers.authorization,
    );

    return true;
  }
}

export function createOidcProviderAuthenticator(): OidcProviderAuthenticator | undefined {
  const enabled = process.env.AUTH_ENABLED;

  if (enabled === undefined || enabled === 'false') return undefined;
  if (enabled !== 'true') throw new Error(ApplicationErrorCode.AUTH_CONFIGURATION_INVALID);

  const issuer = process.env.OIDC_ISSUER;
  const audience = process.env.OIDC_AUDIENCE;
  const jwksUri = process.env.OIDC_JWKS_URI;

  if (!issuer || !audience || !jwksUri)
    throw new Error(ApplicationErrorCode.AUTH_CONFIGURATION_INVALID);

  return new OidcProviderAuthenticator(issuer, audience, jwksUri);
}
