import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { decodeTrap } from '@simoes/snmp-core';
import { OperationsService } from './operations.service';
import { clearedTrapAlertKeys, collectTrapAlerts, recoveredAfter, TrapAlertSource, trapAlertCandidates } from './trap-alerts';

// Synthetic fixtures (not captured from hardware), shared with the snmp-core catalog tests.
const fixtures = (JSON.parse(readFileSync(join(dirname(require.resolve('@simoes/snmp-core/package.json')), 'src', 'fixtures', 'cisco-c9300-traps.synthetic.json'), 'utf8')) as { fixtures: Array<{ name: string; trapOid: string; varbinds: unknown[] }> }).fixtures;
const fixture = (name: string) => { const found = fixtures.find((item) => item.name === name); assert.ok(found, name); return found; };

let seq = 0;
const BOOT_TICKS = 50_000_000; // sysUpTime (1/100 s) at "now" for the synthetic device
const UPTIME = '1.3.6.1.2.1.1.3.0';
/** Sets sysUpTime.0 consistently with receivedAt unless an explicit value is given. */
function withUptime(varbinds: unknown[], ticks: number | null) {
  const rest = (varbinds as Array<{ oid: string }>).filter((item) => item.oid !== UPTIME);
  return ticks === null ? rest : [{ oid: UPTIME, type: 67, value: ticks }, ...rest];
}
/** Moves a FRU fixture to another entPhysicalIndex (rewrites the trailing index of its column varbinds). */
function reindex(varbinds: unknown[], index: number) {
  return (varbinds as Array<{ oid: string }>).map((item) => item.oid.startsWith('1.3.6.1.4.1.9.9.117.1.') ? { ...item, oid: item.oid.replace(/\.\d+$/, `.${index}`) } : item);
}
function trap(name: string, minutesAgo: number, overrides: Partial<TrapAlertSource> & { uptime?: number | null; index?: number } = {}): TrapAlertSource {
  const { uptime, index, ...rest } = overrides;
  const base = fixture(name);
  let varbinds = (rest.varbinds as unknown[] | undefined) ?? base.varbinds;
  if (index !== undefined) varbinds = reindex(varbinds, index);
  varbinds = withUptime(varbinds, uptime === undefined ? Math.round(BOOT_TICKS - minutesAgo * 6000) : uptime);
  const trapOid = rest.trapOid ?? base.trapOid;
  const decoded = decodeTrap(trapOid, varbinds);
  return {
    id: `trap-${++seq}`, dedupKey: null, deviceId: 'dev-1', sourceAddress: '192.0.2.10',
    category: decoded.category, severity: decoded.severity, receivedAt: new Date(Date.now() - minutesAgo * 60_000),
    device: { siteId: 'site-1', name: 'SW-C9300-01' }, enrollment: null, ...rest, trapOid, varbinds,
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

test('each FRU family clears only itself for the same entPhysicalIndex', () => {
  assert.equal(trapAlertCandidates([trap('fru removed', 30)], [trap('fru inserted', 1)]).length, 0);
  assert.equal(trapAlertCandidates([trap('fru power off', 30)], [trap('fru power on', 1)]).length, 0);
  assert.equal(trapAlertCandidates([trap('fru module failed', 30)], [trap('fru module ok', 1)]).length, 0);
  assert.equal(trapAlertCandidates([trap('fru fan tray down', 30)], [trap('fru fan tray up', 1)]).length, 0);
  // a power-off reported after the power-on stays open
  assert.equal(trapAlertCandidates([trap('fru power off', 0.5)], [trap('fru power on', 1)]).length, 1);
});

test('FRU clears never cross condition families on the same entPhysicalIndex', () => {
  const powerOff = trap('fru power off', 30); // entPhysicalIndex 1015
  const fanDown = trap('fru fan tray down', 30, { index: 1015 });
  const moduleDown = trap('fru module failed', 30, { index: 1015 });
  const removed = trap('fru removed', 30);
  const moduleOk = trap('fru module ok', 1, { index: 1015 });
  const fanUp = trap('fru fan tray up', 1, { index: 1015 });
  const inserted = trap('fru inserted', 1);
  const powerOn = trap('fru power on', 1);
  // module ok must not clear power off or fan tray failure
  assert.deepEqual(ids(trapAlertCandidates([powerOff, fanDown, removed], [moduleOk])), [powerOff.id, fanDown.id, removed.id].sort());
  // inserted must not clear power off, fan tray or module failure
  assert.deepEqual(ids(trapAlertCandidates([powerOff, fanDown, moduleDown], [inserted])), [powerOff.id, fanDown.id, moduleDown.id].sort());
  // power on must not clear removed / module / fan tray; fan up must not clear power off / module
  assert.deepEqual(ids(trapAlertCandidates([removed, moduleDown, fanDown], [powerOn])), [removed.id, moduleDown.id, fanDown.id].sort());
  assert.deepEqual(ids(trapAlertCandidates([powerOff, moduleDown], [fanUp])), [powerOff.id, moduleDown.id].sort());
});

test('EnvMon normal states clear only their own family', () => {
  const fan = trap('envmon fan critical', 30);
  const supply = trap('envmon redundant supply failed', 30);
  const supplyOk = trap('envmon supply status change normal', 1);
  const fanOk = trap('envmon fan status change normal', 1);
  assert.equal(decodeTrap(fan.trapOid, fan.varbinds).clearKey?.split(':')[0], 'envFan');
  assert.equal(decodeTrap(supply.trapOid, supply.varbinds).clearKey?.split(':')[0], 'envSupply');
  assert.deepEqual(ids(trapAlertCandidates([fan, supply], [supplyOk])), [fan.id]);
  assert.deepEqual(ids(trapAlertCandidates([fan, supply], [fanOk])), [supply.id]);
});

test('reordered delivery: sysUpTime decides the order within the same boot', () => {
  // linkUp was generated 20 s BEFORE linkDown but arrived 2 s after it → the port is down, keep the alert
  const down = trap('linkDown Gi1/0/1', 1, { uptime: 1_000_000 });
  const lateUp = trap('linkUp Gi1/0/1', 1 - 2 / 60, { uptime: 1_000_000 - 2000 });
  assert.equal(trapAlertCandidates([down], [lateUp]).length, 1);
  // linkUp generated 5 s AFTER linkDown but delivered 1 s before it → cleared
  const down2 = trap('linkDown Gi1/0/1', 1, { uptime: 1_000_000 });
  const earlyUp = trap('linkUp Gi1/0/1', 1 + 1 / 60, { uptime: 1_000_000 + 500 });
  assert.equal(trapAlertCandidates([down2], [earlyUp]).length, 0);
});

test('reordering falls back to receivedAt after a reboot or when sysUpTime is missing', () => {
  // device rebooted between the traps: recovery uptime is small but it arrived 10 minutes later → cleared
  const down = trap('linkDown Gi1/0/1', 11, { uptime: 9_000_000 });
  const upAfterReboot = trap('linkUp Gi1/0/1', 1, { uptime: 6_000 });
  assert.equal(trapAlertCandidates([down], [upAfterReboot]).length, 0);
  // no sysUpTime on the recovery → receivedAt only
  assert.equal(trapAlertCandidates([trap('linkDown Gi1/0/1', 1)], [trap('linkUp Gi1/0/1', 1 + 1 / 60, { uptime: null })]).length, 1);
  assert.equal(recoveredAfter({ receivedAt: new Date(1000) }, { receivedAt: new Date(1000) }), true);
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

function fakeDb(traps: TrapAlertSource[], open: Array<{ id: string; dedupKey: string; entityId: string }>, recoveries: TrapAlertSource[]) {
  const calls: any[] = [];
  return {
    calls,
    snmpTrapEvent: { findMany: async (args: any) => {
      calls.push(args);
      if (args.where?.id?.in) return traps.filter((item) => args.where.id.in.includes(item.id));
      if (args.where?.status === 'PROCESSED') return args.cursor ? [] : recoveries;
      return [...traps].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0, args.take);
    } },
    operationalAlert: { findMany: async (args: any) => args.cursor ? [] : open },
  };
}

test('over the 100-trap cap a cleared alert still resolves through reconcileSource', async () => {
  // 150 WARNING+ traps in the window; the oldest linkDown (beyond the newest 100) has an open alert and a later linkUp
  const noise = Array.from({ length: 149 }, (_, n) => trap('cpu rising', 1 + n * 0.1, { varbinds: [{ oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.10.' + (n + 100), type: 66, value: 95 }] }));
  const oldDown = trap('linkDown Gi1/0/1', 120);
  const up = trap('linkUp Gi1/0/1', 60);
  const openAlerts = [{ id: 'a-old', dedupKey: `snmp:trap:${oldDown.id}`, entityId: oldDown.id }, { id: 'a-noise', dedupKey: `snmp:trap:${noise[0].id}`, entityId: noise[0].id }];
  const db = fakeDb([...noise, oldDown], openAlerts, [up]);
  const result = await collectTrapAlerts(db as never, new Date(Date.now() - 24 * 3600_000));
  assert.equal(result.resolveMissing, false);
  assert.equal(result.candidates.length, 100);
  assert.ok(!result.candidates.some((candidate) => candidate.entityId === oldDown.id));
  assert.deepEqual(result.resolveKeys, [`snmp:trap:${oldDown.id}`]);
  // the older problem trap was loaded by id because its alert is still open
  assert.ok(db.calls.some((args) => args.where?.id?.in?.includes(oldDown.id)));

  // resolveKeys go through the existing resolve path even though resolveMissing is false
  const updates: any[] = []; const finds: any[] = [];
  const prisma = { operationalAlert: {
    findUnique: async () => ({ id: 'existing', status: 'OPEN' }),
    update: async () => ({}),
    findMany: async (args: any) => { finds.push(args); return args.where.dedupKey?.in?.includes(`snmp:trap:${oldDown.id}`) ? [{ id: 'a-old', siteId: 'site-1' }] : []; },
    updateMany: async (args: any) => { updates.push(args); return { count: 1 }; },
  } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  (service as any).publish = async () => undefined;
  const outcome = await service.reconcileSource('SNMP_TRAP', result.candidates, undefined, result.resolveMissing, result.resolveKeys);
  assert.equal(outcome.resolved, 1);
  assert.deepEqual(finds[0].where.dedupKey, { in: [`snmp:trap:${oldDown.id}`] });
  assert.deepEqual(updates[0].where.id, { in: ['a-old'] });
  assert.equal(updates[0].data.status, 'RESOLVED');
});

test('without resolveKeys a capped reconcile resolves nothing (previous behaviour kept)', async () => {
  const prisma = { operationalAlert: { findUnique: async () => null, findMany: async () => { throw new Error('must not query'); }, updateMany: async () => { throw new Error('must not update'); } } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  assert.deepEqual(await service.reconcileSource('SNMP_TRAP', [], undefined, false), { active: 0, resolved: 0 });
});

test('clearedTrapAlertKeys lists only problems with a later recovery', () => {
  const down = trap('linkDown Gi1/0/1', 10, { dedupKey: 'k1' });
  const fan = trap('envmon fan critical', 10);
  assert.deepEqual(clearedTrapAlertKeys([down, fan], [trap('linkUp Gi1/0/1', 1)]), ['snmp:trap:k1']);
});
