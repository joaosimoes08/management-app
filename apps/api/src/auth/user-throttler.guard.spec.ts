import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { Controller, Get, Global, INestApplication, Module } from '@nestjs/common';
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
let app: INestApplication;
let sign: (sub: string) => Promise<string>;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key' };
  sign = (sub) => new SignJWT({ preferred_username: sub, realm_access: { roles: ['READ_ONLY'] } })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer).setAudience('simoes-api').setSubject(sub).setExpirationTime('5m')
    .sign(privateKey);
  // The real AuthModule wiring (guard order included), with the identity store replaced by a stub.
  const module = await Test.createTestingModule({
    imports: [StubDatabaseModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }]), AuthModule],
    controllers: [ProbeController],
  })
    .overrideProvider(AuthService)
    .useValue({ syncUser: async ({ externalId }: { externalId: string }) => ({ id: `id-${externalId}`, externalId, roles: ['READ_ONLY'] }) })
    .compile();
  Object.assign(module.get(AuthGuard), { issuer, audience: 'simoes-api', jwks: createLocalJWKSet({ keys: [publicJwk] }) });
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
});

after(async () => { await app?.close(); });

const call = async (path: string, options: { token?: string; ip?: string } = {}) => {
  const response = await (app as NestFastifyApplication).getHttpAdapter().getInstance().inject({
    method: 'GET', url: `/throttle-probe/${path}`, remoteAddress: options.ip ?? '10.0.0.1',
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
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

test('anonymous requests are keyed by IP', async () => {
  assert.deepEqual([await call('public', { ip: '10.0.0.2' }), await call('public', { ip: '10.0.0.2' })], [200, 200]);
  assert.equal(await call('public', { ip: '10.0.0.2' }), 429);
  assert.equal(await call('public', { ip: '10.0.0.3' }), 200);
});

test('tracker uses the verified user id and ignores client-supplied identity headers', async () => {
  const guard = Object.create(UserThrottlerGuard.prototype) as { getTracker(request: Record<string, unknown>): Promise<string> };
  assert.equal(await guard.getTracker({ ip: '10.0.0.1', user: { id: 'u1' } }), 'user:u1');
  assert.equal(await guard.getTracker({ ip: '10.0.0.1', headers: { 'x-user-id': 'u1', 'x-forwarded-for': '1.2.3.4' } }), 'ip:10.0.0.1');
});
