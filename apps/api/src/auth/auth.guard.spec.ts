import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AuthGuard } from './auth.guard';

function contextWith(token: string) {
  const request = { headers: { authorization: `Bearer ${token}` }, ip: '127.0.0.1' };
  return {
    context: {
      getHandler: () => contextWith,
      getClass: () => AuthGuard,
      switchToHttp: () => ({ getRequest: () => request }),
    },
    request,
  };
}

async function signedToken() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';
  const token = await new SignJWT({ preferred_username: 'reader', realm_access: { roles: ['READ_ONLY'] } })
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .setIssuer('https://issuer.example/realms/test')
    .setAudience('simoes-api')
    .setSubject('keycloak-user-1')
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, jwks: createLocalJWKSet({ keys: [publicJwk] }) };
}

test('database failures after JWT validation are not converted to invalid-token errors', async () => {
  const databaseFailure = new Error('database unavailable');
  const authService = { syncUser: async () => { throw databaseFailure; } };
  const guard = new AuthGuard({ getAllAndOverride: () => false } as never, authService as never);
  const { token, jwks } = await signedToken();
  Object.assign(guard as object, {
    issuer: 'https://issuer.example/realms/test',
    audience: 'simoes-api',
    jwks,
  });

  const { context } = contextWith(token);
  await assert.rejects(() => guard.canActivate(context as never), (error: unknown) => error === databaseFailure);
});

test('malformed bearer tokens still fail as unauthorized', async () => {
  const guard = new AuthGuard({ getAllAndOverride: () => false } as never, { syncUser: async () => undefined } as never);
  const { context } = contextWith('undefined');

  await assert.rejects(() => guard.canActivate(context as never), UnauthorizedException);
});
