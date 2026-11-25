import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { Controller, Get, Global, Module } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@simoes/database';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AuthGuard } from './auth.guard';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { UserThrottlerGuard } from './user-throttler.guard';
import { trustProxyHops, trustProxyOptions } from '../common/trust-proxy';

@Controller('throttle-probe')
class ProbeController {
  @Get('private') privateRoute() { return { ok: true }; }
  @Public() @Get('public') publicRoute() { return { ok: true }; }
}

// Stands in for the global DatabaseModule; only audit writes would reach it, and GETs are not audited.
@Global()
@Module({ providers: [{ provide: PrismaClient, useValue: { auditLog: { create: async () => ({}) } } }], exports: [PrismaClient] })
class StubDatabaseModule {}

const issuer = 'https://issuer.example/realms/test';
const NGINX = '172.18.0.5'; // TCP peer for every request that comes through the bundled nginx
let app: NestFastifyApplication;
let appHops0: NestFastifyApplication;
let sign: (sub: string) => Promise<string>;
let publicJwk: Record<string, unknown>;

// The real AuthModule wiring (guard order included), with the identity store replaced by a stub, on a Fastify
// adapter built from TRUST_PROXY_HOPS exactly as createApp() does.
const buildApp = async (hopsEnv: string | undefined) => {
  const module = await Test.createTestingModule({
    imports: [StubDatabaseModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }]), AuthModule],
    controllers: [ProbeController],
  })
    .overrideProvider(AuthService)
    .useValue({ syncUser: async ({ externalId }: { externalId: string }) => ({ id: `id-${externalId}`, externalId, roles: ['READ_ONLY'] }) })
    .compile();
  Object.assign(module.get(AuthGuard), { issuer, audience: 'simoes-api', jwks: createLocalJWKSet({ keys: [publicJwk as never] }) });
  const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(trustProxyOptions(trustProxyHops(hopsEnv))));
  await instance.init();
  await instance.getHttpAdapter().getInstance().ready();
  return instance;
};

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key' };
  sign = (sub) => new SignJWT({ preferred_username: sub, realm_access: { roles: ['READ_ONLY'] } })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer).setAudience('simoes-api').setSubject(sub).setExpirationTime('5m')
    .sign(privateKey);
  app = await buildApp('1'); // shipped proxy setting
  appHops0 = await buildApp(undefined); // default: no proxy in front
});

after(async () => { await app?.close(); await appHops0?.close(); });

const call = async (path: string, options: { token?: string; ip?: string; xff?: string; target?: NestFastifyApplication } = {}) => {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.xff) headers['x-forwarded-for'] = options.xff;
  const response = await (options.target ?? app).getHttpAdapter().getInstance().inject({
    method: 'GET', url: `/throttle-probe/${path}`, remoteAddress: options.ip ?? NGINX, headers,
  });
  return response.statusCode;
};

test('two users behind the same proxy address do not share a bucket', async () => {
  const [alice, bob] = await Promise.all([sign('alice'), sign('bob')]);
  assert.deepEqual([await call('private', { token: alice }), await call('private', { token: alice })], [200, 200]);
  assert.deepEqual([await call('private', { token: bob }), await call('private', { token: bob })], [200, 200]);
});

test('one user exhausting the limit does not get another user throttled', async () => {
  const [carol, dave] = await Promise.all([sign('carol'), sign('dave')]);
  await call('private', { token: carol });
  await call('private', { token: carol });
  assert.equal(await call('private', { token: carol }), 429);
  assert.equal(await call('private', { token: dave }), 200);
});

test('a token with a bad signature is rejected before it can claim a user bucket', async () => {
  const forged = `${(await sign('erin')).slice(0, -4)}AAAA`;
  assert.equal(await call('private', { token: forged, ip: '10.0.0.9' }), 401);
});

test('without a proxy (hops=0) anonymous requests are keyed by the TCP peer', async () => {
  const target = appHops0;
  assert.deepEqual([await call('public', { target, ip: '10.0.0.2' }), await call('public', { target, ip: '10.0.0.2' })], [200, 200]);
  assert.equal(await call('public', { target, ip: '10.0.0.2' }), 429);
  assert.equal(await call('public', { target, ip: '10.0.0.3' }), 200);
});

test('behind nginx (hops=1) two anonymous clients get two buckets', async () => {
  await call('public', { xff: '203.0.113.10' });
  await call('public', { xff: '203.0.113.10' });
  assert.equal(await call('public', { xff: '203.0.113.10' }), 429);
  assert.equal(await call('public', { xff: '203.0.113.11' }), 200);
});

test('hops=0 ignores X-Forwarded-For, so a client cannot pick its own bucket', async () => {
  const target = appHops0;
  const peer = '10.0.0.20';
  await call('public', { target, ip: peer, xff: '198.51.100.1' });
  await call('public', { target, ip: peer, xff: '198.51.100.2' });
  assert.equal(await call('public', { target, ip: peer, xff: '198.51.100.3' }), 429);
});

test('hops=1 ignores a spoofed extra left-most X-Forwarded-For entry', async () => {
  // nginx appends the real client with $proxy_add_x_forwarded_for; anything to its left came from the client.
  await call('public', { xff: '203.0.113.20' });
  await call('public', { xff: '6.6.6.1, 203.0.113.20' });
  assert.equal(await call('public', { xff: '6.6.6.2, 203.0.113.20' }), 429);
  assert.equal(await call('public', { xff: '203.0.113.20, 203.0.113.21' }), 200);
});

test('hops=2 (two proxies) keys anonymous clients by the address two hops back, not a client-supplied one', async () => {
  const target = await buildApp('2');
  try {
    // [peer, outer proxy, client]: X-Forwarded-For is "<spoof>, client, outer proxy".
    await call('public', { target, xff: '6.6.6.1, 203.0.113.40, 10.9.0.1' });
    await call('public', { target, xff: '6.6.6.2, 203.0.113.40, 10.9.0.1' });
    assert.equal(await call('public', { target, xff: '6.6.6.3, 203.0.113.40, 10.9.0.1' }), 429);
    assert.equal(await call('public', { target, xff: '203.0.113.41, 10.9.0.1' }), 200);
  } finally { await target.close(); }
});

test('hops=1 still keys signed-in users by user id, not by forwarded address', async () => {
  const [frank, grace] = await Promise.all([sign('frank'), sign('grace')]);
  await call('private', { token: frank, xff: '203.0.113.30' });
  await call('private', { token: frank, xff: '203.0.113.31' });
  assert.equal(await call('private', { token: frank, xff: '203.0.113.32' }), 429);
  assert.equal(await call('private', { token: grace, xff: '203.0.113.30' }), 200);
});

test('TRUST_PROXY_HOPS parsing: default 0, exact hop count, never true, rejects junk', () => {
  assert.equal(trustProxyHops(undefined), 0);
  assert.equal(trustProxyHops(''), 0);
  assert.equal(trustProxyHops('0'), 0);
  assert.equal(trustProxyHops(' 1 '), 1);
  assert.equal(trustProxyHops('2'), 2);
  assert.deepEqual(trustProxyOptions(0), {});
  assert.equal(typeof trustProxyOptions(1).trustProxy, 'function'); // first-N-hops function, see trust-proxy.spec.ts
  for (const bad of ['true', '-1', '1.5', 'abc']) assert.throws(() => trustProxyHops(bad), /non-negative integer/);
});

test('tracker uses the verified user id and ignores client-supplied identity headers', async () => {
  const guard = Object.create(UserThrottlerGuard.prototype) as { getTracker(request: Record<string, unknown>): Promise<string> };
  assert.equal(await guard.getTracker({ ip: '10.0.0.1', user: { id: 'u1' } }), 'user:u1');
  assert.equal(await guard.getTracker({ ip: '10.0.0.1', headers: { 'x-user-id': 'u1', 'x-forwarded-for': '1.2.3.4' } }), 'ip:10.0.0.1');
});
