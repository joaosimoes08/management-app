import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { trustFirstHops, trustProxyHops, trustProxyOptions } from './trust-proxy';

/**
 * Fastify up to 5.11 turned a numeric trustProxy into `(a, i) => i < tp`. Fastify 5.12 rejects a number in its
 * types and treats it as "trust nothing" at runtime, so the hop count is now passed as trustFirstHops(n).
 * These tests pin request.ip / request.ips for every configured value to what that 5.11 rule produced.
 */
const PEER = '10.0.0.5';
const apps: FastifyInstance[] = [];
after(async () => { await Promise.all(apps.map((app) => app.close())); });

async function appFor(env: string | undefined) {
  const app = Fastify(trustProxyOptions(trustProxyHops(env)));
  app.get('/ip', async (request) => ({ ip: request.ip, ips: request.ips ?? null }));
  await app.ready();
  apps.push(app);
  return app;
}

async function ipOf(app: FastifyInstance, xff?: string, peer = PEER) {
  const response = await app.inject({ method: 'GET', url: '/ip', remoteAddress: peer, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
  return response.json() as { ip: string; ips: string[] | null };
}

/** The Fastify 5.11 numeric rule, written out: trust hops 0..n-1 of [peer, ...X-Forwarded-For right to left]. */
function fastify511Ip(hops: number, peer: string, xff?: string) {
  if (hops <= 0) return peer; // trustProxyOptions(0) passes nothing, as before
  const chain = [peer, ...(xff ? xff.split(',').map((part) => part.trim()).filter(Boolean).reverse() : [])];
  return chain[Math.min(hops, chain.length - 1)];
}

const chains = [undefined, '', '203.0.113.7', '6.6.6.6, 203.0.113.7', '1.1.1.1, 6.6.6.6, 203.0.113.7', '9.9.9.9, 1.1.1.1, 6.6.6.6, 203.0.113.7'];

for (const env of [undefined, '', '0', '1', '2', '3']) {
  test(`TRUST_PROXY_HOPS=${env === undefined ? '(unset)' : JSON.stringify(env)}: request.ip matches the Fastify 5.11 hop-count rule`, async () => {
    const app = await appFor(env);
    const hops = trustProxyHops(env);
    for (const xff of chains) assert.equal((await ipOf(app, xff)).ip, fastify511Ip(hops, PEER, xff), `xff=${String(xff)}`);
  });
}

test('default and 0 ignore X-Forwarded-For entirely: request.ip is the TCP peer', async () => {
  for (const env of [undefined, '0']) {
    const app = await appFor(env);
    assert.deepEqual(await ipOf(app, '198.51.100.1'), { ip: PEER, ips: null });
    assert.equal((await ipOf(app, '198.51.100.1', '10.0.0.9')).ip, '10.0.0.9');
  }
});

test('1 (bundled nginx) takes the right-most entry and ignores what a client adds on the left', async () => {
  const app = await appFor('1');
  assert.deepEqual(await ipOf(app, '203.0.113.7'), { ip: '203.0.113.7', ips: [PEER, '203.0.113.7'] });
  assert.equal((await ipOf(app, '6.6.6.6, 203.0.113.7')).ip, '203.0.113.7');
  assert.equal((await ipOf(app)).ip, PEER); // no header: the peer itself
});

test('2 trusts exactly two hops, never the whole chain', async () => {
  const app = await appFor('2');
  assert.equal((await ipOf(app, '6.6.6.6, 203.0.113.7, 10.1.1.1')).ip, '203.0.113.7');
  assert.deepEqual((await ipOf(app, '6.6.6.6, 203.0.113.7, 10.1.1.1')).ips, [PEER, '10.1.1.1', '203.0.113.7']);
});

test('trustFirstHops is the 5.11 function: hop index below n is trusted, whatever the address', () => {
  const trust = trustFirstHops(2);
  assert.deepEqual([0, 1, 2, 3].map((hop) => trust('6.6.6.6', hop)), [true, true, false, false]);
  assert.deepEqual(trustProxyOptions(0), {});
  assert.equal(typeof trustProxyOptions(1).trustProxy, 'function');
});

test('a plain number would now trust nothing (why the function is needed)', async () => {
  const app = Fastify({ trustProxy: 1 as unknown as boolean });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  await app.ready();
  apps.push(app);
  assert.equal((await ipOf(app, '203.0.113.7')).ip, PEER);
});
