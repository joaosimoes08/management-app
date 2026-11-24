import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { identityHints, IdentityDevice, matchIdentity, normaliseHostName, normaliseSerial } from './discovery-identity';
import { DiscoveryIdentityService } from './discovery-identity.service';

const field = (value: string) => ({ value, oid: '1.3.6', source: 'SNMP' as const, credentialId: 'c1', observedAt: '2026-11-24T10:00:00.000Z' });
const enriched = (fields: Record<string, string>, status = 'OK') => ({ status, credentialId: 'c1', observedAt: '2026-11-24T10:00:00.000Z', durationMs: 12, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, field(value)])) });
const device = (id: string, patch: Partial<IdentityDevice> = {}): IdentityDevice => ({ id, name: `Device ${id}`, hostname: null, managementIp: null, serialNumber: null, siteId: 's1', status: 'ACTIVE', ...patch });

test('D-P1c: serials and host names are normalised; placeholder serials identify nothing', () => {
  assert.equal(normaliseSerial(' foc2318x0ab '), 'FOC2318X0AB');
  for (const junk of ['', '  ', 'N/A', 'unknown', '0', 'To be filled by O.E.M.', 'ab', null, undefined]) assert.equal(normaliseSerial(junk), null, String(junk));
  assert.equal(normaliseHostName('Core-SW-01.lab.local'), 'core-sw-01');
  assert.equal(normaliseHostName('  '), null);
});

test('D-P1c: hints come only from SNMP readings that succeeded', () => {
  assert.deepEqual(identityHints({ address: '10.0.0.2', snmp: enriched({ entitySerial: 'FOC1', sysName: 'SW1.corp' }) }), { address: '10.0.0.2', serial: 'FOC1', sysName: 'sw1' });
  assert.deepEqual(identityHints({ address: '10.0.0.2', snmp: enriched({ sysName: 'sw1' }, 'PARTIAL') }), { address: '10.0.0.2', serial: null, sysName: 'sw1' });
  assert.deepEqual(identityHints({ address: '10.0.0.2', snmp: { status: 'AUTH_FAILED', fields: {} } }), { address: '10.0.0.2', serial: null, sysName: null });
  assert.deepEqual(identityHints({ address: '10.0.0.2', snmp: null }), { address: '10.0.0.2', serial: null, sysName: null });
});

test('D-P1c: confidence follows the signals: serial HIGH, IP+sysName HIGH, IP MEDIUM, sysName alone LOW', () => {
  const hints = { address: '10.0.0.2', serial: 'FOC1', sysName: 'sw1' };
  const bySerial = matchIdentity(hints, [device('a', { serialNumber: 'foc1', managementIp: '10.9.9.9' })]);
  assert.deepEqual(bySerial.signals, ['MANAGEMENT_IP', 'SERIAL', 'SYSNAME']);
  assert.equal(bySerial.candidates[0].confidence, 'HIGH');
  assert.deepEqual(bySerial.candidates[0].reasons, [{ code: 'SERIAL_MATCH', discovered: 'FOC1', registered: 'foc1' }]);

  const noSerial = { ...hints, serial: null };
  assert.equal(matchIdentity(noSerial, [device('b', { managementIp: '10.0.0.2', hostname: 'SW1.corp.local' })]).candidates[0].confidence, 'HIGH');
  assert.equal(matchIdentity(noSerial, [device('c', { managementIp: '10.0.0.2' })]).candidates[0].confidence, 'MEDIUM');
  const byName = matchIdentity(noSerial, [device('d', { name: 'sw1' })]).candidates[0];
  assert.equal(byName.confidence, 'LOW');
  assert.deepEqual(byName.reasons, [{ code: 'SYSNAME_MATCH', discovered: 'sw1', registered: 'sw1' }]);
});

test('D-P1c: a contradicting serial caps the match at LOW and says why', () => {
  const result = matchIdentity({ address: '10.0.0.2', serial: 'FOC1', sysName: 'sw1' }, [device('a', { managementIp: '10.0.0.2', hostname: 'sw1', serialNumber: 'FOC2' })]);
  assert.equal(result.candidates[0].confidence, 'LOW');
  assert.deepEqual(result.candidates[0].reasons.map((reason) => reason.code), ['MANAGEMENT_IP_MATCH', 'SYSNAME_MATCH', 'SERIAL_MISMATCH']);
});

test('D-P1c: candidates are ranked, capped at three, ambiguity is flagged, and devices with no match are left out', () => {
  const hints = { address: '10.0.0.2', serial: null, sysName: 'sw1' };
  const result = matchIdentity(hints, [
    device('z', { name: 'sw1' }), device('y', { hostname: 'sw1.a' }), device('x', { name: 'SW1' }), device('w', { name: 'sw1' }),
    device('ip', { managementIp: '10.0.0.2' }), device('none', { name: 'other', managementIp: '10.0.0.3' }),
  ]);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].deviceId, 'ip');
  assert.equal(result.ambiguous, false);
  assert.equal(result.candidates.some((candidate) => candidate.deviceId === 'none'), false);
  const tie = matchIdentity({ ...hints, address: '10.0.0.9' }, [device('a', { name: 'sw1' }), device('b', { name: 'sw1' })]);
  assert.equal(tie.ambiguous, true);
  assert.deepEqual(matchIdentity({ address: '10.0.0.9', serial: null, sysName: null }, [device('a', { managementIp: '10.0.0.2' })]), { signals: ['MANAGEMENT_IP'], candidates: [], ambiguous: false });
});

test('D-P1c service: devices the caller may not read are never suggested, and nothing is written', async () => {
  const queries: unknown[] = [];
  const prisma = new Proxy({ $queryRaw: async (sql: unknown) => { queries.push(sql); return [device('visible', { managementIp: '10.0.0.2' }), device('hidden', { serialNumber: 'FOC1' })]; } }, {
    get: (target, key) => { if (key in target) return target[key as keyof typeof target]; throw new Error(`unexpected prisma access: ${String(key)}`); },
  });
  const checked: string[] = [];
  const infrastructure = { assertDevice: async (_user: unknown, action: string, id: string) => { checked.push(`${action}:${id}`); if (id === 'hidden') throw new NotFoundException(); return { id }; } };
  const service = new DiscoveryIdentityService(prisma as never, infrastructure as never);
  const identities = await service.forResults({ id: 'u1', roles: ['NETWORK_OPERATOR'] } as never, [{ id: 'r1', address: '10.0.0.2', snmp: enriched({ entitySerial: 'FOC1' }) }]);
  assert.deepEqual(identities.get('r1')!.candidates.map((candidate) => [candidate.deviceId, candidate.confidence]), [['visible', 'MEDIUM']]);
  assert.deepEqual(checked.sort(), ['READ:hidden', 'READ:visible']);
  assert.equal(queries.length, 1);

  const empty = await service.forResults({ id: 'u1', roles: ['ADMIN'] } as never, []);
  assert.equal(empty.size, 0);
  assert.equal(queries.length, 1, 'no query for a job without results');
});

test('D-P1c service: unexpected errors from the scope check are not swallowed', async () => {
  const service = new DiscoveryIdentityService({ $queryRaw: async () => [device('a', { managementIp: '10.0.0.2' })] } as never, { assertDevice: async () => { throw new Error('db down'); } } as never);
  await assert.rejects(service.forResults({ id: 'u1', roles: ['ADMIN'] } as never, [{ id: 'r1', address: '10.0.0.2', snmp: null }]), /db down/);
});
