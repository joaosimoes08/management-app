import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload, JWTVerifyGetKey } from 'jose';

export type OidcVerifierConfig = { issuer: string; audience: string; jwks: JWTVerifyGetKey };

export function resolveJwksUrl(issuer: string, backchannelUrl?: string): URL {
  const baseUrl = (backchannelUrl?.trim() || issuer).replace(/\/+$/, '');
  return new URL(`${baseUrl}/protocol/openid-connect/certs`);
}

export function oidcIssuerFromEnv(): string {
  return process.env.OIDC_ISSUER_URL ?? 'http://localhost:8080/realms/COCiber';
}

/** Issuer, audience and JWKS from the same environment variables the AuthGuard has always read. */
export function oidcVerifierConfigFromEnv(): OidcVerifierConfig {
  const issuer = oidcIssuerFromEnv();
  return {
    issuer,
    audience: process.env.OIDC_AUDIENCE ?? 'simoes-api',
    jwks: createRemoteJWKSet(resolveJwksUrl(issuer, process.env.OIDC_BACKCHANNEL_URL)),
  };
}

export function realmRoles(payload: JWTPayload): string[] {
  const realmAccess = payload.realm_access;
  if (!realmAccess || typeof realmAccess !== 'object' || !Array.isArray((realmAccess as { roles?: unknown }).roles)) return [];
  return (realmAccess as { roles: unknown[] }).roles.filter((role): role is string => typeof role === 'string');
}

/**
 * Verifies a `Bearer` Authorization header: signature (JWKS), issuer, audience (aud or azp) and a user identity
 * (sub + preferred_username). Throws UnauthorizedException for anything that is not a valid user token.
 * Shared by the global AuthGuard and the API docs (Swagger) access check.
 */
export async function verifyBearerToken(authorization: string | undefined, config: OidcVerifierConfig): Promise<JWTPayload> {
  if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException();
  try {
    const { payload } = await jwtVerify(authorization.slice('Bearer '.length), config.jwks, { issuer: config.issuer });
    assertAudience(payload, config.audience);
    if (!payload.sub || typeof payload.preferred_username !== 'string') throw new UnauthorizedException('Token sem identidade de utilizador');
    return payload;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[AuthGuard] OIDC validation failed:', error instanceof Error ? error.message : error);
    }
    if (error instanceof UnauthorizedException) throw error;
    throw new UnauthorizedException('Token inválido');
  }
}

function assertAudience(payload: JWTPayload, audience: string): void {
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(audience) && payload.azp !== audience) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[AuthGuard] Audience mismatch: expected=${audience}, aud=${audiences.join(',') || '(none)'}, azp=${payload.azp ?? '(none)'}`);
    }
    throw new UnauthorizedException('Audience inválida');
  }
}
