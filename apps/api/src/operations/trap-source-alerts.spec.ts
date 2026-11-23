import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { collectTrapSourceAlerts, planTrapSourceAlerts, TRAP_SOURCE_ALERT_SOURCE, TRAP_SOURCE_AMBIGUOUS_ENTITY, trapSourceDedupKey, trapSourceDeviceMap } from './trap-alerts';
import { OperationsService } from './operations.service';

// SNMP Phase 1 step 2: UNMATCHED and REJECTED traps raise one WARNING alert per source IP.
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const row = (sourceAddress: string, status: string, count: number, minutesAgo: number, errorCode: string | null = null) => ({ sourceAddress, status, errorCode, count, lastAt: at(minutesAgo) });

test('one alert per source IP, whatever the number of bad traps', () => {
  const plan = planTrapSourceAlerts([
    row('10.0.0.5', 'UNMATCHED', 40, 3),
    row('10.0.0.5', 'REJECTED', 12, 1, 'SNMP_TRAP_UNKNOWN_USER'),
    row('10.0.0.5', 'REJECTED', 2, 2, 'SNMP_V2C_DISABLED'),
    row('10.0.0.9', 'REJECTED', 1, 10, 'SNMP_TRAP_AUTH_FAILED'),
  ], new Map(), new Map([['10.0.0.5', { siteId: 'site-1', name: 'SW-01' }]]));
  assert.deepEqual(plan.candidates.map((alert) => alert.dedupKey), [trapSourceDedupKey('10.0.0.5'), trapSourceDedupKey('10.0.0.9')]);
  const [first, second] = plan.candidates;
  assert.equal(first.source, TRAP_SOURCE_ALERT_SOURCE);
  assert.equal(first.severity, 'WARNING');
  assert.equal(first.siteId, 'site-1');
  assert.equal(first.occurrenceCount, 54);
  assert.match(first.title, /10\.0\.0\.5 \(SW-01\)/);
  assert.match(first.detail, /40 sem equipamento.*14 rejeitado\(s\) \(SNMP_TRAP_UNKNOWN_USER, SNMP_V2C_DISABLED\)/);
  assert.equal(second.siteId, null, 'unknown IP: global alert');
  assert.equal(plan.resolveMissing, true);
});

test('an accepted trap after the last bad one resolves the source; a later bad trap reopens it', () => {
  const accepted = new Map([['10.0.0.5', at(1)]]);
  const resolvedNow = planTrapSourceAlerts([row('10.0.0.5', 'REJECTED', 3, 5, 'SNMP_TRAP_UNKNOWN_USER')], accepted, new Map());
  assert.deepEqual(resolvedNow.candidates, []);
  assert.deepEqual(resolvedNow.resolveKeys, [trapSourceDedupKey('10.0.0.5')]);
  const again = planTrapSourceAlerts([row('10.0.0.5', 'REJECTED', 4, 0.5, 'SNMP_TRAP_UNKNOWN_USER')], accepted, new Map());
  assert.equal(again.candidates.length, 1);
});

test('a manual resolve holds until a new bad trap arrives after it', () => {
  const key = trapSourceDedupKey('10.0.0.5');
  assert.deepEqual(planTrapSourceAlerts([row('10.0.0.5', 'UNMATCHED', 3, 10)], new Map(), new Map(), new Map([[key, at(5)]])).candidates, []);
  assert.equal(planTrapSourceAlerts([row('10.0.0.5', 'UNMATCHED', 3, 1)], new Map(), new Map(), new Map([[key, at(5)]])).candidates.length, 1);
});

test('collectTrapSourceAlerts reads grouped counts, ignores self-tests and maps the site by management IP', async () => {
  const calls: any[] = [];
  const db = {
    snmpTrapEvent: { groupBy: async (args: any) => {
      calls.push(args);
      if (args.where.status.in.includes('UNMATCHED')) return [
        { sourceAddress: '10.0.0.5', status: 'REJECTED', errorCode: 'SNMP_TRAP_UNKNOWN_USER', _count: { _all: 2 }, _max: { receivedAt: at(1) } },
        { sourceAddress: '10.0.0.7', status: 'UNMATCHED', errorCode: null, _count: { _all: 1 }, _max: { receivedAt: at(3) } },
      ];
      return [{ sourceAddress: '10.0.0.7', _max: { receivedAt: at(2) } }];
    } },
    device: { findMany: async () => [{ managementIp: '10.0.0.5', siteId: 'site-1', name: 'SW-01' }] },
    operationalAlert: { findMany: async () => [] },
  };
  const result = await collectTrapSourceAlerts(db as never, at(24 * 60));
  assert.deepEqual(result.candidates.map((alert) => [alert.dedupKey, alert.siteId]), [[trapSourceDedupKey('10.0.0.5'), 'site-1']]);
  assert.deepEqual(result.resolveKeys, [trapSourceDedupKey('10.0.0.7')], '10.0.0.7 later sent an accepted trap');
  assert.deepEqual(calls[0].where.status.in, ['UNMATCHED', 'REJECTED']);
  assert.deepEqual(calls[0].where.OR, [{ category: null }, { category: { not: 'SELF_TEST' } }]);
  assert.deepEqual(calls[1].where.status.in, ['PENDING', 'PROCESSED', 'DISCOVERED']);
  assert.equal(result.resolveMissing, true);
});

test('no bad traps in 24 h: nothing to raise and open source alerts resolve', async () => {
  const db = { snmpTrapEvent: { groupBy: async () => [] }, device: { findMany: async () => [] }, operationalAlert: { findMany: async () => [] } };
  assert.deepEqual(await collectTrapSourceAlerts(db as never, at(24 * 60)), { candidates: [], resolveKeys: [], resolveMissing: true });
});

test('a source IP documented in two sites is logged and left without a site instead of picking the last one', () => {
  const warnings: Array<Record<string, unknown>> = [];
  const map = trapSourceDeviceMap([
    { managementIp: '10.0.0.1', siteId: 'site-b', name: 'sw-b' },
    { managementIp: '10.0.0.1', siteId: 'site-a', name: 'sw-a' },
    { managementIp: '10.0.0.2', siteId: 'site-a', name: 'sw-2' },
    { managementIp: null, siteId: 'site-a', name: 'no-ip' },
  ], (_message, meta) => warnings.push(meta), new Map());
  assert.deepEqual(map.get('10.0.0.1'), { siteId: null, name: 'sw-a / sw-b', ambiguous: true });
  assert.deepEqual(map.get('10.0.0.2'), { siteId: 'site-a', name: 'sw-2' });
  assert.equal(map.size, 2);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0], { errorCode: 'SNMP_TRAP_SOURCE_AMBIGUOUS', sourceAddress: '10.0.0.1', siteIds: ['site-a', 'site-b'], devices: ['sw-a', 'sw-b'] });
  const plan = planTrapSourceAlerts([{ sourceAddress: '10.0.0.1', status: 'UNMATCHED', errorCode: null, count: 1, lastAt: new Date('2026-11-23T10:00:00Z') }], new Map(), map);
  assert.equal(plan.candidates[0].siteId, null);
  assert.equal(plan.candidates[0].entityType, TRAP_SOURCE_AMBIGUOUS_ENTITY, 'ambiguous alert is admin-only');
  assert.equal(plan.candidates[0].entityId, '10.0.0.1');
  const plain = planTrapSourceAlerts([{ sourceAddress: '10.0.0.2', status: 'UNMATCHED', errorCode: null, count: 1, lastAt: new Date('2026-11-23T10:00:00Z') }], new Map(), map);
  assert.equal(plain.candidates[0].entityType, null, 'single-site IP keeps the site-scoped alert');
});

test('SNMP_TRAP_SOURCE_AMBIGUOUS is logged once per IP until its sites or devices change', () => {
  const warnings: Array<Record<string, unknown>> = [];
  const warn = (_message: string, meta: Record<string, unknown>) => { warnings.push(meta); };
  const logged = new Map<string, string>();
  const two = [{ managementIp: '10.0.0.1', siteId: 'site-a', name: 'sw-a' }, { managementIp: '10.0.0.1', siteId: 'site-b', name: 'sw-b' }];
  for (let cycle = 0; cycle < 5; cycle += 1) trapSourceDeviceMap(two, warn, logged);
  assert.equal(warnings.length, 1, 'same ambiguity on every cycle: logged once');
  trapSourceDeviceMap([...two, { managementIp: '10.0.0.1', siteId: 'site-c', name: 'sw-c' }], warn, logged);
  assert.equal(warnings.length, 2, 'a third site is a change: logged again');
  assert.deepEqual(warnings[1].siteIds, ['site-a', 'site-b', 'site-c']);
  trapSourceDeviceMap([two[0]], warn, logged);
  trapSourceDeviceMap(two, warn, logged);
  assert.equal(warnings.length, 3, 'resolved and then ambiguous again: logged again');
});

test('a non-admin who sees only one of the two sites does not see the ambiguous alert or its device names', async () => {
  const map = trapSourceDeviceMap([
    { managementIp: '10.0.0.1', siteId: 'site-a', name: 'sw-a' },
    { managementIp: '10.0.0.1', siteId: 'site-b', name: 'sw-b' },
    { managementIp: '10.0.0.2', siteId: 'site-a', name: 'sw-2' },
  ], () => undefined, new Map());
  const lastAt = new Date('2026-11-23T10:00:00Z');
  const plan = planTrapSourceAlerts([
    { sourceAddress: '10.0.0.1', status: 'UNMATCHED', errorCode: null, count: 1, lastAt },
    { sourceAddress: '10.0.0.2', status: 'UNMATCHED', errorCode: null, count: 1, lastAt },
    { sourceAddress: '10.0.0.9', status: 'UNMATCHED', errorCode: null, count: 1, lastAt },
  ], new Map(), map);
  const stored = plan.candidates.map((alert, index) => ({ ...alert, id: `alert-${index}`, status: 'OPEN', userStates: [] }));
  const prisma = {
    site: { findMany: async () => [{ id: 'site-a' }, { id: 'site-b' }] },
    alertRule: { findMany: async () => [] },
    maintenanceWindow: { findMany: async () => [] },
    operationalAlert: { findMany: async () => stored },
    snmpJob: { findMany: async () => [] },
    snmpDrift: { findMany: async () => [] },
    snmpTrapEvent: { findMany: async () => [] },
  };
  const access = { assertSite: async (_user: unknown, _action: string, siteId: string) => { if (siteId !== 'site-a') throw new Error('forbidden'); } };
  const service = new OperationsService(prisma as never, access as never, {} as never, {} as never);
  const viewer = await service.list({ id: 'viewer', roles: ['VIEWER'] } as never);
  const titles = viewer.items.map((item: any) => item.title as string);
  assert.equal(titles.length, 2, 'site-a alert and the unknown-IP alert only');
  assert.ok(titles.some((title) => title.includes('10.0.0.2 (sw-2)')));
  assert.ok(titles.some((title) => title.includes('10.0.0.9')));
  assert.ok(!titles.some((title) => title.includes('10.0.0.1') || title.includes('sw-b')), 'ambiguous IP and the other site\'s device stay hidden');
  const admin = await service.list({ id: 'admin', roles: ['ADMIN'] } as never);
  assert.equal(admin.items.length, 3, 'admins still see the ambiguous alert');
});
