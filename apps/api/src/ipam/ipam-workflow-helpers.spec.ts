import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { discoveryJobDurationMs, findFreeIpv4, parseSubnetListOptions, subnetNonUsableAddresses, subnetUtilization, subnetUtilizationFromCounts, utilizationBand } from './ipam-workflow-helpers';

test('utilisation bands: OK below 80, WARNING from 80, CRITICAL from 90, UNTRACKED for IPv6', () => {
  assert.equal(utilizationBand(79.99), 'OK');
  assert.equal(utilizationBand(80), 'WARNING');
  assert.equal(utilizationBand(90), 'CRITICAL');
  assert.equal(utilizationBand(null), 'UNTRACKED');
  const v4 = subnetUtilization('10.0.0.0/29', '10.0.0.1', [{ address: '10.0.0.2', state: 'OCCUPIED' }, { address: '10.0.0.3', state: 'RESERVED' }]);
  assert.deepEqual(v4, { usableCapacity: 5, allocated: 2, occupied: 1, reserved: 1, free: 3, utilizationPercent: 40, band: 'OK' });
  assert.equal(subnetUtilization('2001:db8::/64', null, []).band, 'UNTRACKED');
});

test('subnet list options parse band, minimum and sort', () => {
  assert.deepEqual(parseSubnetListOptions({}), {});
  assert.deepEqual(parseSubnetListOptions({ band: 'warning,critical', minUtilization: '50', sort: 'utilization' }), { band: ['WARNING', 'CRITICAL'], minUtilization: 50, sort: { by: 'utilization', direction: 'desc' } });
  assert.deepEqual(parseSubnetListOptions({ sort: 'cidr:desc' }), { sort: { by: 'cidr', direction: 'desc' } });
  assert.throws(() => parseSubnetListOptions({ band: 'HOT' }));
  assert.throws(() => parseSubnetListOptions({ minUtilization: '101' }));
  assert.throws(() => parseSubnetListOptions({ sort: 'name' }));
});

test('next free IPv4 skips network, gateway, broadcast and blocked addresses, inside the range', () => {
  assert.deepEqual(findFreeIpv4('10.0.0.0/29', '10.0.0.1', new Set(['10.0.0.2']), 3), { supported: true, addresses: ['10.0.0.3', '10.0.0.4', '10.0.0.5'] });
  assert.deepEqual(findFreeIpv4('10.0.0.0/29', '10.0.0.1', new Set(), 10).addresses, ['10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5', '10.0.0.6']);
  assert.deepEqual(findFreeIpv4('10.0.0.0/24', null, new Set(['10.0.0.20']), 2, '10.0.0.20', '10.0.0.30').addresses, ['10.0.0.21', '10.0.0.22']);
  assert.deepEqual(findFreeIpv4('2001:db8::/64', null, new Set(), 1), { supported: false, addresses: [] });
  assert.throws(() => findFreeIpv4('10.0.0.0/24', null, new Set(), 1, '10.0.1.1'));
  assert.throws(() => findFreeIpv4('10.0.0.0/24', null, new Set(), 1, '10.0.0.50', '10.0.0.10'));
});

test('discovery run duration is null until the job has both timestamps', () => {
  assert.equal(discoveryJobDurationMs({ startedAt: new Date('2026-11-21T10:00:00Z'), completedAt: new Date('2026-11-21T10:01:30Z') }), 90_000);
  assert.equal(discoveryJobDurationMs({ startedAt: new Date(), completedAt: null }), null);
});

test('utilisation from SQL counts matches the row-based maths once network/broadcast/gateway rows are removed', () => {
  const cases: Array<[string, string | null, Array<{ address: string; state: string }>]> = [
    ['10.0.0.0/29', '10.0.0.1', [{ address: '10.0.0.0', state: 'OCCUPIED' }, { address: '10.0.0.1', state: 'RESERVED' }, { address: '10.0.0.2', state: 'OCCUPIED' }, { address: '10.0.0.3', state: 'UNKNOWN' }, { address: '10.0.0.4', state: 'RESERVED' }, { address: '10.0.0.5', state: 'EXCLUDED' }, { address: '10.0.0.7', state: 'OCCUPIED' }]],
    ['192.168.10.0/24', null, Array.from({ length: 230 }, (_, index) => ({ address: `192.168.10.${index + 1}`, state: index % 3 ? 'OCCUPIED' : 'RESERVED' }))],
    ['10.9.9.0/31', null, [{ address: '10.9.9.0', state: 'OCCUPIED' }]],
    ['2001:db8::/64', null, [{ address: '2001:db8::5', state: 'OCCUPIED' }, { address: '2001:db8::6', state: 'RESERVED' }]],
    ['not-a-cidr', null, []],
  ];
  for (const [cidr, gateway, rows] of cases) {
    const edges = new Set(subnetNonUsableAddresses(cidr, gateway));
    const counts: Record<string, number> = {};
    for (const row of rows) if (!edges.has(row.address)) counts[row.state] = (counts[row.state] ?? 0) + 1;
    const expected = subnetUtilization(cidr, gateway, rows);
    const actual = subnetUtilizationFromCounts(cidr, gateway, counts);
    if (cidr.includes(':')) { assert.equal(actual.band, 'UNTRACKED'); assert.equal(actual.utilizationPercent, null); continue; }
    assert.deepEqual(actual, expected, cidr);
  }
  assert.deepEqual(subnetNonUsableAddresses('10.0.0.0/29', '10.0.0.1').sort(), ['10.0.0.0', '10.0.0.1', '10.0.0.7']);
  assert.deepEqual(subnetNonUsableAddresses('10.0.0.0/31', null), []);
});

test('findFreeIpv4 skips blocked spans arithmetically, so a /8 with a dense blocked prefix is instant', () => {
  const blocked = new Set<string>();
  for (let index = 1; index <= 70_000; index++) blocked.add(`10.${Math.floor(index / 65536)}.${Math.floor(index / 256) % 256}.${index % 256}`);
  const started = Date.now();
  const found = findFreeIpv4('10.0.0.0/8', '10.0.0.1', blocked, 3);
  assert.deepEqual(found.addresses, ['10.1.17.113', '10.1.17.114', '10.1.17.115']);
  assert.ok(Date.now() - started < 1000);
  // Range bounds and gateway still apply.
  assert.deepEqual(findFreeIpv4('10.0.0.0/24', '10.0.0.5', new Set(['10.0.0.4', '10.0.0.6']), 2, '10.0.0.4', '10.0.0.8').addresses, ['10.0.0.7', '10.0.0.8']);
  assert.deepEqual(findFreeIpv4('10.0.0.0/30', null, new Set(['10.0.0.1', '10.0.0.2']), 2).addresses, []);
});
