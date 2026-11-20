import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { decodeTrap } from '@simoes/snmp-core';
import { TrapAlertSource, trapAlertCandidates } from './trap-alerts';

// Synthetic fixtures (not captured from hardware), shared with the snmp-core catalog tests.
const fixtures = (JSON.parse(readFileSync(join(dirname(require.resolve('@simoes/snmp-core/package.json')), 'src', 'fixtures', 'cisco-c9300-traps.synthetic.json'), 'utf8')) as { fixtures: Array<{ name: string; trapOid: string; varbinds: unknown[] }> }).fixtures;
const fixture = (name: string) => { const found = fixtures.find((item) => item.name === name); assert.ok(found, name); return found; };

let seq = 0;
function trap(name: string, minutesAgo: number, overrides: Partial<TrapAlertSource> = {}): TrapAlertSource {
  const { trapOid, varbinds } = fixture(name);
  const decoded = decodeTrap(trapOid, varbinds);
  return {
    id: `trap-${++seq}`, dedupKey: null, deviceId: 'dev-1', sourceAddress: '192.0.2.10', trapOid, varbinds,
    category: decoded.category, severity: decoded.severity, receivedAt: new Date(Date.now() - minutesAgo * 60_000),
    device: { siteId: 'site-1', name: 'SW-C9300-01' }, enrollment: null, ...overrides,
  };
}
const ids = (alerts: ReturnType<typeof trapAlertCandidates>) => alerts.map((alert) => alert.entityId).sort();

test('linkUp resolves the open linkDown alert for the same device and ifIndex only', () => {
  const down = trap('linkDown Gi1/0/1', 10);
  const otherPort = trap('linkDown Gi1/0/1', 10, { varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.11', type: 2, value: 11 }], trapOid: '1.3.6.1.6.3.1.1.5.3' });
  const otherDevice = trap('linkDown Gi1/0/1', 10, { deviceId: 'dev-2' });
  assert.equal(trapAlertCandidates([down, otherPort, otherDevice], []).length, 3);
  const up = trap('linkUp Gi1/0/1', 5);
  assert.deepEqual(ids(trapAlertCandidates([down, otherPort, otherDevice], [up])), [otherPort.id, otherDevice.id].sort());
});

test('a recovery older than the problem does not resolve it', () => {
  const down = trap('linkDown Gi1/0/1', 5);
  const earlierUp = trap('linkUp Gi1/0/1', 10);
  assert.deepEqual(ids(trapAlertCandidates([down], [earlierUp])), [down.id]);
});

test('cpmCPUFallingThreshold resolves Rising for the same CPU index', () => {
  const rising = trap('cpu rising', 20);
  const falling = trap('cpu falling', 2);
  assert.equal(trapAlertCandidates([rising], []).length, 1);
  assert.equal(trapAlertCandidates([rising], [falling]).length, 0);
  const otherCpu = trap('cpu falling', 2, { varbinds: [{ oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.10.8', type: 66, value: 10 }] });
  assert.equal(trapAlertCandidates([rising], [otherCpu]).length, 1);
});

test('FRU inserted / power on resolves removed / power off for the same entPhysicalIndex', () => {
  const removed = trap('fru removed', 30);
  const off = trap('fru power off', 30);
  assert.equal(trapAlertCandidates([removed, off], [trap('fru inserted', 1)]).length, 0);
  assert.equal(trapAlertCandidates([removed, off], [trap('fru power on', 1)]).length, 0);
  // a power-off reported after the power-on stays open
  assert.equal(trapAlertCandidates([trap('fru power off', 0.5)], [trap('fru power on', 1)]).length, 1);
});

test('stack new member resolves member removed for the same switch number', () => {
  const removed = trap('stack member removed', 15);
  assert.equal(trapAlertCandidates([removed], [trap('stack new member', 3)]).length, 0);
  const otherSwitch = trap('stack new member', 3, { varbinds: [{ oid: '1.3.6.1.4.1.9.9.500.1.2.1.1.1.4000', type: 66, value: 4 }] });
  assert.equal(trapAlertCandidates([removed], [otherSwitch]).length, 1);
});

test('a problem-state trap passed as a recovery never resolves anything', () => {
  const down = trap('linkDown Gi1/0/1', 10);
  assert.equal(trapAlertCandidates([down], [trap('linkDown Gi1/0/1', 1)]).length, 1);
});

test('traps without a device correlate by source address', () => {
  const down = trap('linkDown Gi1/0/1', 10, { deviceId: null, device: null, enrollment: { siteId: 'site-1' } });
  assert.equal(trapAlertCandidates([down], [trap('linkUp Gi1/0/1', 1, { deviceId: null })]).length, 0);
  assert.equal(trapAlertCandidates([down], [trap('linkUp Gi1/0/1', 1, { deviceId: null, sourceAddress: '192.0.2.99' })]).length, 1);
});

test('alerts use the readable Portuguese label and keep dedupKey, severity and site mapping', () => {
  const fan = trap('envmon fan critical', 1, { dedupKey: 'abc' });
  const [alert] = trapAlertCandidates([fan], []);
  assert.equal(alert.dedupKey, 'snmp:trap:abc');
  assert.equal(alert.title, 'Falha de ventoinha – Switch 1 - FAN 2');
  assert.equal(alert.detail, 'SW-C9300-01 · estado critical');
  assert.equal(alert.severity, 'HIGH');
  assert.equal(alert.siteId, 'site-1');
  assert.equal(alert.source, 'SNMP_TRAP');
  assert.equal(alert.actionHref, '/snmp');
  const [shutdown] = trapAlertCandidates([trap('envmon shutdown', 1)], []);
  assert.equal(shutdown.severity, 'CRITICAL');
  assert.equal(shutdown.title, 'Encerramento por condição ambiental');
});

test('StackPower traps never alert and unknown WARNING+ traps keep the previous generic title', () => {
  assert.equal(trapAlertCandidates([trap('stackpower under budget', 1, { severity: 'WARNING' })], []).length, 0);
  const unknown = trap('unknown vendor trap', 1, { severity: 'WARNING', category: 'VENDOR' });
  const [alert] = trapAlertCandidates([unknown], []);
  assert.equal(alert.title, 'Trap SNMP VENDOR');
  assert.equal(alert.detail, 'SW-C9300-01');
});
