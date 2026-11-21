import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ApplicationLinksService, CHECK_ALL_BATCH } from './application-links.service';
import { isBlockedAddress, probeLink } from './link-probe';

function withAllowed<T>(value: string | undefined, run: () => Promise<T>) {
  const previous = process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS;
  if (value === undefined) delete process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS; else process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS = value;
  return run().finally(() => { if (previous === undefined) delete process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS; else process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS = previous; });
}

test('isBlockedAddress blocks loopback, RFC1918, link-local, CGNAT and IPv6 local ranges', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.254', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'not-an-ip']) assert.equal(isBlockedAddress(address), true, address);
  for (const address of ['8.8.8.8', '193.0.6.139', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888']) assert.equal(isBlockedAddress(address), false, address);
});

test('isBlockedAddress decodes IPv4 embedded in NAT64 and 6to4 addresses and blocks local-use NAT64', () => {
  for (const address of ['64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::c0a8:101', '2002:7f00:1::', '2002:a00:1::1', '2002:a9fe:a9fe::', '64:ff9b:1::808:808', '64:ff9b:1:ffff::1', '::ffff:7f00:1']) assert.equal(isBlockedAddress(address), true, address);
  for (const address of ['64:ff9b::808:808', '64:ff9b::8.8.8.8', '2002:808:808::1', '2001:db8::7f00:1', '64:ff9c::7f00:1']) assert.equal(isBlockedAddress(address), false, address);
});

test('probeLink reports BLOCKED for private literals and for names that resolve to loopback, without connecting', async () => {
  await withAllowed(undefined, async () => {
    for (const url of ['http://10.255.255.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:9/', 'http://[fd00::1]/', 'http://100.64.0.1/', 'http://localhost:9/', 'http://[64:ff9b::7f00:1]:9/', 'http://[2002:7f00:1::]:9/']) {
      assert.equal((await probeLink(url, 1500)).code, 'BLOCKED', url);
    }
    assert.equal((await probeLink('ftp://example.com/')).code, 'INVALID_URL');
  });
});

test('probeLink checks redirect targets without following them, and honours the operator allowlist', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/to-metadata') { res.statusCode = 302; res.setHeader('location', 'http://169.254.169.254/latest/'); }
    else if (req.url === '/to-self') { res.statusCode = 301; res.setHeader('location', '/up'); }
    else res.statusCode = req.url === '/down' ? 503 : 200;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await withAllowed(undefined, async () => assert.equal((await probeLink(`${base}/up`)).code, 'BLOCKED'));
    await withAllowed('127.0.0.1/32', async () => {
      const up = await probeLink(`${base}/up`);
      assert.equal(up.available, true); assert.equal(up.httpStatus, 200); assert.equal(up.code, undefined);
      assert.equal((await probeLink(`${base}/down`)).available, false);
      const redirected = await probeLink(`${base}/to-metadata`);
      assert.equal(redirected.code, 'BLOCKED'); assert.equal(redirected.available, false); assert.equal(redirected.httpStatus, 302);
      const self = await probeLink(`${base}/to-self`);
      assert.equal(self.available, true); assert.equal(self.httpStatus, 301);
    });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

function fakeLinksService(count: number, probe: (url: string) => Promise<{ available: boolean; httpStatus: number | null; responseMs: number | null; code?: 'BLOCKED' }>) {
  const links = Array.from({ length: count }, (_, index) => ({ id: `l${index}`, name: `Link ${index}`, url: `http://link-${index}.example/` }));
  const prisma = {
    applicationLink: {
      findUnique: async ({ where }: { where: { id: string } }) => links.find((link) => link.id === where.id),
      count: async () => links.length,
      findMany: async ({ skip, take }: { skip: number; take: number }) => links.slice(skip, skip + take),
      update: async ({ data }: { data: object }) => data,
    },
  };
  const service = new ApplicationLinksService(prisma as never, { record: async () => undefined } as never);
  (service as unknown as { probe: typeof probe }).probe = probe;
  return service;
}

test('check returns the blocked reason alongside persisted availability', async () => {
  const service = fakeLinksService(1, async () => ({ available: false, httpStatus: null, responseMs: null, code: 'BLOCKED' }));
  const checked = await service.check('l0', { id: 'admin', roles: ['ADMIN'] } as never);
  assert.equal(checked.code, 'BLOCKED');
  assert.equal(checked.isAvailable, false);
  assert.ok(checked.lastCheckedAt instanceof Date);
});

test('checkAll caps each call at 100 links with 10 concurrent probes and returns nextOffset for the rest', async () => {
  let running = 0; let peak = 0;
  const service = fakeLinksService(130, async (url) => {
    running++; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running--;
    return url.includes('link-3.') ? { available: false, httpStatus: null, responseMs: null, code: 'BLOCKED' } : { available: true, httpStatus: 200, responseMs: 1 };
  });
  const first = await service.checkAll({ id: 'admin', roles: ['ADMIN'] } as never, true);
  assert.equal(first.checked, CHECK_ALL_BATCH); assert.equal(first.total, 130); assert.equal(first.nextOffset, 100);
  assert.equal(first.blocked, 1); assert.equal(first.items.find((item) => item.id === 'l3')?.code, 'BLOCKED');
  assert.ok(peak <= 10, `peak concurrency ${peak}`);
  const second = await service.checkAll({ id: 'admin', roles: ['ADMIN'] } as never, true, '100');
  assert.equal(second.checked, 30); assert.equal(second.nextOffset, null);
  await assert.rejects(service.checkAll({ id: 'admin', roles: ['ADMIN'] } as never, true, '-1'));
});

test('checkAll stops starting probes once its time budget is spent and resumes from nextOffset', async () => {
  const service = fakeLinksService(50, async () => { await new Promise((resolve) => setTimeout(resolve, 40)); return { available: true, httpStatus: 200, responseMs: 40 }; });
  const started = Date.now();
  const partial = await service.checkAll({ id: 'admin', roles: ['ADMIN'] } as never, true, undefined, 60);
  assert.ok(Date.now() - started < 400);
  assert.ok(partial.checked >= 10 && partial.checked < 50, `checked ${partial.checked}`);
  assert.equal(partial.nextOffset, partial.checked);
  assert.deepEqual(partial.items.map((item) => item.id), Array.from({ length: partial.checked }, (_, index) => `l${index}`));
});
