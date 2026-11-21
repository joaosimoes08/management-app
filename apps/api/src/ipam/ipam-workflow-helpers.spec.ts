import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { discoveryJobDurationMs, findFreeIpv4, parseSubnetListOptions, subnetUtilization, utilizationBand } from './ipam-workflow-helpers';

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
