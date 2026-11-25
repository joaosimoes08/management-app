import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { configureApp, CORS_ALLOWED_HEADERS, ConfigureAppOptions } from '../app.factory';
import { TagsController } from '../tags/tags.controller';
import { TagsService } from '../tags/tags.service';
import { swaggerEnabledFromEnv } from './swagger';

const ISSUER = 'https://issuer.example/realms/test';

@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get() probe() { return { ok: true }; }
}

@Module({ controllers: [ProbeController, TagsController], providers: [{ provide: TagsService, useValue: {} }] })
class DocsTestModule {}

let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = 'docs-test';
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

function token(roles: string[], overrides: { issuer?: string; audience?: string } = {}) {
  return new SignJWT({ preferred_username: 'docs-reader', realm_access: { roles } })
    .setProtectedHeader({ alg: 'RS256', kid: 'docs-test' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? 'simoes-api')
    .setSubject('keycloak-user-docs')
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function buildApp(options: Omit<ConfigureAppOptions, 'swaggerSetup'>) {
  const module = await Test.createTestingModule({ imports: [DocsTestModule] }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await configureApp(app, { ...options, swaggerSetup: { verifier: { issuer: ISSUER, audience: 'simoes-api', jwks }, issuerUrl: 'https://kc.example/realms/test', clientId: 'simoes-web' } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('CORS', () => {
  test('X-Test-User is absent from the production CORS config', async () => {
    assert.equal(CORS_ALLOWED_HEADERS.some((header) => header.toLowerCase() === 'x-test-user'), false);
    const app = await buildApp({ swagger: false });
    try {
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/probe',
        headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-test-user' },
      });
      const allowed = String(preflight.headers['access-control-allow-headers']).toLowerCase().split(',').map((header) => header.trim());
      assert.deepEqual(allowed, ['content-type', 'authorization', 'accept-language']);
      assert.equal(allowed.includes('x-test-user'), false);
    } finally {
      await app.close();
    }
  });
});

describe('Swagger enabled', () => {
  let app: NestFastifyApplication;
  before(async () => { app = await buildApp({ swagger: true }); });
  after(async () => { await app.close(); });

  test('/api-json and /api-yaml return 401 without a token or with an invalid one', async () => {
    for (const url of ['/api-json', '/api-yaml']) {
      const anonymous = await app.inject({ method: 'GET', url });
      assert.equal(anonymous.statusCode, 401, url);
      assert.equal(anonymous.json().code, 'HTTP_401');
      assert.doesNotMatch(anonymous.body, /\/api\/v1\/probe/);
      const garbage = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer not-a-jwt' } });
      assert.equal(garbage.statusCode, 401, url);
      const wrongIssuer = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await token(['ADMIN'], { issuer: 'https://evil.example/realms/test' })}` } });
      assert.equal(wrongIssuer.statusCode, 401, url);
      const wrongAudience = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await token(['ADMIN'], { audience: 'other-api' })}` } });
      assert.equal(wrongAudience.statusCode, 401, url);
      const queryString = await app.inject({ method: 'GET', url: `${url}?x=1` });
      assert.equal(queryString.statusCode, 401, `${url}?x=1`);
    }
  });

  test('/api-json returns 403 for a valid token without ADMIN', async () => {
    const response = await app.inject({ method: 'GET', url: '/api-json', headers: { authorization: `Bearer ${await token(['READ_ONLY'])}` } });
    assert.equal(response.statusCode, 403);
    assert.doesNotMatch(response.body, /\/api\/v1\/probe/);
  });

  test('/api-json and /api-yaml return 200 with a valid ADMIN token, keeping the bearer scheme', async () => {
    const authorization = `Bearer ${await token(['ADMIN'])}`;
    const json = await app.inject({ method: 'GET', url: '/api-json', headers: { authorization } });
    assert.equal(json.statusCode, 200, json.body);
    assert.equal(json.headers['cache-control'], 'no-store');
    const spec = json.json();
    assert.ok(spec.paths['/api/v1/probe']);
    assert.deepEqual(spec.components.securitySchemes.bearer, { scheme: 'bearer', bearerFormat: 'JWT', type: 'http' });
    assert.equal(spec.components.securitySchemes.keycloak.flows.authorizationCode.authorizationUrl, 'https://kc.example/realms/test/protocol/openid-connect/auth');
    const yaml = await app.inject({ method: 'GET', url: '/api-yaml', headers: { authorization } });
    assert.equal(yaml.statusCode, 200);
    assert.match(yaml.body, /\/api\/v1\/probe:/);
  });

  test('registered examples appear on the wired endpoints', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api-json', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } })).json();
    const list = spec.paths['/api/v1/tags'].get.responses['200'].content['application/json'].examples;
    assert.equal(list['tags.list'].summary, 'Etiquetas de um Site');
    const create = spec.paths['/api/v1/tags'].post;
    assert.deepEqual(create.requestBody.content['application/json'].examples['tags.create.request'].value.name, 'Produção');
    assert.ok(create.responses['201'].content['application/json'].examples['tags.create.response']);
  });

  test('the UI page is a shell: its init script carries no API paths and signs in with PKCE', async () => {
    const redirect = await app.inject({ method: 'GET', url: '/api' });
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.headers.location, '/api/');
    const page = await app.inject({ method: 'GET', url: '/api/' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /SimoesDocsAuth/);
    for (const url of ['/api/swagger-ui-init.js', '/api/api/swagger-ui-init.js']) {
      const init = await app.inject({ method: 'GET', url });
      assert.equal(init.statusCode, 200, url);
      assert.doesNotMatch(init.body, /\/api\/v1\/probe|\/api\/v1\/tags/, url);
      assert.match(init.body, /"usePkceWithAuthorizationCodeGrant": true/);
      assert.match(init.body, /"clientId": "simoes-web"/);
      assert.match(init.body, /protocol\/openid-connect\/auth/);
    }
    const redirectPage = await app.inject({ method: 'GET', url: '/api/oauth2-redirect.html' });
    assert.equal(redirectPage.statusCode, 200);
    // The sign-in popup must keep its link to the docs page; everything else keeps Helmet's strict policy.
    assert.equal(page.headers['cross-origin-opener-policy'], 'same-origin-allow-popups');
    assert.equal(redirectPage.headers['cross-origin-opener-policy'], 'unsafe-none');
    assert.equal((await app.inject({ method: 'GET', url: '/api-json' })).headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/probe' })).headers['cross-origin-opener-policy'], 'same-origin');
  });
});

describe('Swagger disabled', () => {
  test('/api-json, /api-yaml and the UI return 404', async () => {
    const app = await buildApp({ swagger: false });
    try {
      for (const url of ['/api-json', '/api-yaml', '/api', '/api/', '/api/swagger-ui-init.js']) {
        const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
        assert.equal(response.statusCode, 404, url);
      }
    } finally {
      await app.close();
    }
  });
});

describe('SWAGGER_ENABLED', () => {
  test('defaults to on outside production and off in production; explicit values win', () => {
    assert.equal(swaggerEnabledFromEnv({}), true);
    assert.equal(swaggerEnabledFromEnv({ NODE_ENV: 'development' }), true);
    assert.equal(swaggerEnabledFromEnv({ NODE_ENV: 'production' }), false);
    assert.equal(swaggerEnabledFromEnv({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }), true);
    assert.equal(swaggerEnabledFromEnv({ NODE_ENV: 'production', SWAGGER_ENABLED: '1' }), true);
    assert.equal(swaggerEnabledFromEnv({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }), false);
    assert.equal(swaggerEnabledFromEnv({ SWAGGER_ENABLED: '0' }), false);
  });

  test('production with SWAGGER_ENABLED=true still requires a token', async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, SWAGGER_ENABLED: process.env.SWAGGER_ENABLED };
    process.env.NODE_ENV = 'production';
    process.env.SWAGGER_ENABLED = 'true';
    try {
      const app = await buildApp({});
      try {
        assert.equal((await app.inject({ method: 'GET', url: '/api-json' })).statusCode, 401);
        assert.equal((await app.inject({ method: 'GET', url: '/api-json', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } })).statusCode, 200);
      } finally {
        await app.close();
      }
      delete process.env.SWAGGER_ENABLED;
      const off = await buildApp({});
      try {
        assert.equal((await off.inject({ method: 'GET', url: '/api-json' })).statusCode, 404);
      } finally {
        await off.close();
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
