import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { decodeTrap } from '@simoes/snmp-core';
import { OperationsService } from './operations.service';
import { Logger } from '@nestjs/common';
import { clearedTrapAlertKeys, collectTrapAlerts, recoveredAfter, storedTrapUptime, TrapAlertSource, trapAlertCandidates, trapUptimeTicks } from './trap-alerts';

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
  // linkUp generated 5 s AFTER linkDown but delivered 1 s before it: receivedAt and uptime
  // disagree → conservative agreement rule keeps the alert open
  const down2 = trap('linkDown Gi1/0/1', 1, { uptime: 1_000_000 });
  const earlyUp = trap('linkUp Gi1/0/1', 1 + 1 / 60, { uptime: 1_000_000 + 500 });
  assert.equal(trapAlertCandidates([down2], [earlyUp]).length, 1);
  // both orders agree (later by receivedAt and by uptime, same boot) → cleared
  const down3 = trap('linkDown Gi1/0/1', 1, { uptime: 1_000_000 });
  const up3 = trap('linkUp Gi1/0/1', 1 - 2 / 60, { uptime: 1_000_000 + 200 });
  assert.equal(trapAlertCandidates([down3], [up3]).length, 0);
});

const MIN = 60 * 100; // one minute in TimeTicks

test('ambiguous reboot (Guita case A): small uptimes from different boots never resolve', () => {
  // linkDown at uptime 3 min → reboot → linkUp at uptime 1 min received 60 s later: ambiguous → stays open
  const down = trap('linkDown Gi1/0/1', 2, { uptime: 3 * MIN });
  const up = trap('linkUp Gi1/0/1', 1, { uptime: 1 * MIN });
  assert.equal(trapAlertCandidates([down], [up]).length, 1);
  assert.equal(recoveredAfter({ receivedAt: down.receivedAt, uptime: 3 * MIN }, { receivedAt: up.receivedAt, uptime: 1 * MIN }), false);
});

test('ambiguous reboot (Guita case B): a pre-reboot linkUp delivered late never resolves the new linkDown', () => {
  // linkDown at uptime 1 min after reboot; linkUp generated before the reboot (uptime 3 min) arrives 60 s later
  const down = trap('linkDown Gi1/0/1', 2, { uptime: 1 * MIN });
  const lateUp = trap('linkUp Gi1/0/1', 1, { uptime: 3 * MIN });
  assert.equal(trapAlertCandidates([down], [lateUp]).length, 1);
  assert.equal(recoveredAfter({ receivedAt: down.receivedAt, uptime: 1 * MIN }, { receivedAt: lateUp.receivedAt, uptime: 3 * MIN }), false);
});

test('large uptimes from different boots (delta mismatch) never resolve', () => {
  const down = trap('linkDown Gi1/0/1', 11, { uptime: 9_000_000 });
  const upAfterReboot = trap('linkUp Gi1/0/1', 1, { uptime: 6 * MIN * 10 });
  assert.equal(trapAlertCandidates([down], [upAfterReboot]).length, 1);
});

test('coldStart/warmStart from the same device between or around the traps keeps the problem open', () => {
  const down = trap('linkDown Gi1/0/1', 30);
  const up = trap('linkUp Gi1/0/1', 10);
  const boot = (minutesAgo: number, oid: string, deviceId = 'dev-1') => ({ id: `boot-${++seq}`, deviceId, sourceAddress: deviceId === 'dev-1' ? '192.0.2.10' : '192.0.2.20', trapOid: oid, varbinds: [], receivedAt: new Date(Date.now() - minutesAgo * 60_000) });
  assert.equal(trapAlertCandidates([down], [up]).length, 0);
  assert.equal(trapAlertCandidates([down], [up, boot(20, '1.3.6.1.6.3.1.1.5.1')]).length, 1, 'coldStart between');
  assert.equal(trapAlertCandidates([down], [up, boot(20, '1.3.6.1.6.3.1.1.5.2')]).length, 1, 'warmStart between');
  assert.equal(trapAlertCandidates([down], [up, boot(32, '1.3.6.1.6.3.1.1.5.1')]).length, 1, 'coldStart just before the problem (within tolerance)');
  assert.equal(trapAlertCandidates([down], [up, boot(60, '1.3.6.1.6.3.1.1.5.1')]).length, 0, 'coldStart well before both');
  assert.equal(trapAlertCandidates([down], [up, boot(20, '1.3.6.1.6.3.1.1.5.1', 'dev-2')]).length, 0, 'coldStart from another device and IP');
});

test('receivedAt alone decides only when BOTH traps lack sysUpTime; one-sided uptime stays open', () => {
  // only the problem has uptime → ambiguous → open
  assert.equal(trapAlertCandidates([trap('linkDown Gi1/0/1', 5)], [trap('linkUp Gi1/0/1', 1, { uptime: null })]).length, 1);
  // only the recovery has uptime → ambiguous → open
  assert.equal(trapAlertCandidates([trap('linkDown Gi1/0/1', 5, { uptime: null })], [trap('linkUp Gi1/0/1', 1)]).length, 1);
  assert.equal(recoveredAfter({ receivedAt: new Date(1000), uptime: 9_000_000 }, { receivedAt: new Date(2000) }), false);
  // both missing → receivedAt decides
  assert.equal(trapAlertCandidates([trap('linkDown Gi1/0/1', 5, { uptime: null })], [trap('linkUp Gi1/0/1', 1, { uptime: null })]).length, 0);
  assert.equal(trapAlertCandidates([trap('linkDown Gi1/0/1', 1, { uptime: null })], [trap('linkUp Gi1/0/1', 5, { uptime: null })]).length, 1);
  assert.equal(recoveredAfter({ receivedAt: new Date(1000) }, { receivedAt: new Date(1000) }), true);
});

const bootTrap = (minutesAgo: number, overrides: Record<string, unknown> = {}) => ({ id: `boot-${++seq}`, deviceId: null as string | null, sourceAddress: '192.0.2.10', trapOid: '1.3.6.1.6.3.1.1.5.1', varbinds: [], receivedAt: new Date(Date.now() - minutesAgo * 60_000), ...overrides });

test('an UNMATCHED coldStart (no device) from the problem\'s source IP between the traps keeps the alert open', () => {
  const down = trap('linkDown Gi1/0/1', 30);
  const up = trap('linkUp Gi1/0/1', 10);
  assert.equal(trapAlertCandidates([down], [up], []).length, 0);
  assert.equal(trapAlertCandidates([down], [up], [bootTrap(20)]).length, 1, 'same IP, deviceId null');
  assert.deepEqual(clearedTrapAlertKeys([down], [up], [bootTrap(20)]), []);
  assert.equal(trapAlertCandidates([down], [up], [bootTrap(20, { sourceAddress: '192.0.2.99' })]).length, 0, 'other IP, no device');
  assert.equal(trapAlertCandidates([down], [up], [bootTrap(20, { deviceId: 'dev-1', sourceAddress: '198.51.100.7' })]).length, 1, 'same device, other IP');
  // device-less problem: a boot from the same IP blocks too
  const looseDown = trap('linkDown Gi1/0/1', 30, { deviceId: null });
  const looseUp = trap('linkUp Gi1/0/1', 10, { deviceId: null });
  assert.equal(trapAlertCandidates([looseDown], [looseUp], [bootTrap(20)]).length, 1);
});

test('Guita case C: a pre-reboot linkUp delivered >5 min late stays open when the boot trap is present', () => {
  // linkUp generated before the reboot at uptime 20 min; reboot; linkDown at uptime 10 min (received 10 min ago);
  // the stale linkUp is delivered 10 min after the linkDown. Uptimes look consistent (20 − 10 = 10 min),
  // so only the coldStart (delivered after the problem, ahead of the stale linkUp) can tell.
  const down = trap('linkDown Gi1/0/1', 10, { uptime: 10 * MIN });
  const staleUp = trap('linkUp Gi1/0/1', 0, { uptime: 20 * MIN });
  assert.equal(trapAlertCandidates([down], [staleUp]).length, 0, 'documented residual: without the boot trap it clears');
  assert.equal(trapAlertCandidates([down], [staleUp], [bootTrap(5, { deviceId: 'dev-1' })]).length, 1);
});

test('uptime comes from the stored uptimeTicks column first, parsed as a number, then the varbind', () => {
  const fixtureUptime = (fixture('linkDown Gi1/0/1').varbinds as Array<{ oid: string; value: unknown }>).find((item) => item.oid === '1.3.6.1.2.1.1.3.0')?.value;
  assert.equal(typeof fixtureUptime, 'number'); // net-snmp TimeTicks → number, stored unchanged by normalizedValue
  // the receiver stores uptimeTicks as String(value)
  assert.equal(storedTrapUptime({ uptimeTicks: String(fixtureUptime), varbinds: [] }), 123456);
  assert.equal(typeof storedTrapUptime({ uptimeTicks: '123456', varbinds: [] }), 'number');
  assert.equal(storedTrapUptime({ uptimeTicks: '777', varbinds: [{ oid: '1.3.6.1.2.1.1.3.0', type: 67, value: 999 }] }), 777);
  assert.equal(storedTrapUptime({ uptimeTicks: '', varbinds: [{ oid: '1.3.6.1.2.1.1.3.0', type: 67, value: 999 }] }), 999);
  assert.equal(storedTrapUptime({ uptimeTicks: null, varbinds: [{ oid: '.1.3.6.1.2.1.1.3.0', type: 67, value: '4321' }] }), 4321);
  assert.equal(storedTrapUptime({ uptimeTicks: 'abc', varbinds: [] }), undefined);
  assert.equal(trapUptimeTicks('not-an-array'), undefined);
  // the column wins over a conflicting varbind when deciding order
  const down = trap('linkDown Gi1/0/1', 1, { uptime: 1_000_000, uptimeTicks: '1000000' });
  const lateUp = trap('linkUp Gi1/0/1', 1 - 2 / 60, { uptime: 2_000_000, uptimeTicks: String(1_000_000 - 2000) });
  assert.equal(trapAlertCandidates([down], [lateUp]).length, 1);
});

/** Uplink fixture: dev-1 Gi1/0/1 (ifIndex 9) is documented as connected to another switch. */
const UPLINK = { interfaceId: 'if-uplink', deviceId: 'dev-1', ifIndex: 9, name: 'GigabitEthernet1/0/1' };
function uplinkDb(uplinks: Array<typeof UPLINK> = [UPLINK], peerType = 'SWITCH') {
  return {
    deviceConnection: { findMany: async () => uplinks.map((item) => ({ sourceDeviceId: item.deviceId, sourceInterfaceId: item.interfaceId, targetDeviceId: 'peer', targetInterfaceId: null, sourceDevice: { type: 'SWITCH' }, targetDevice: { type: peerType } })) },
    deviceInterface: { findMany: async (args: any) => uplinks.filter((item) => args.where.id.in.includes(item.interfaceId)).map((item) => ({ id: item.interfaceId, deviceId: item.deviceId, name: item.name, portKey: null })) },
    snmpInterfaceObservation: { findMany: async (args: any) => uplinks.filter((item) => args.where.deviceInterfaceId.in.includes(item.interfaceId)).map((item) => ({ deviceInterfaceId: item.interfaceId, ifIndex: item.ifIndex })) },
  };
}

function fakeDb(traps: TrapAlertSource[], open: Array<{ id: string; dedupKey: string; entityId: string; occurrenceCount?: number }>, recoveries: TrapAlertSource[], boots: unknown[] = [], uplinks = uplinkDb()) {
  const calls: any[] = [];
  return {
    ...uplinks,
    calls,
    snmpTrapEvent: { findMany: async (args: any) => {
      calls.push(args);
      if (args.where?.id?.in) return traps.filter((item) => args.where.id.in.includes(item.id));
      if (args.where?.status === 'PROCESSED') return args.cursor ? [] : recoveries;
      if (args.where?.trapOid?.in?.includes('1.3.6.1.6.3.1.1.5.1')) return args.cursor ? [] : boots;
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
  // a port problem clears both its legacy per-trap key and its per-port group key
  assert.deepEqual(clearedTrapAlertKeys([down, fan], [trap('linkUp Gi1/0/1', 1)]), ['snmp:trap:k1', 'snmp:trap:device:dev-1:interface:9']);
});

test('reconcileSource resolves cleared keys in batches of 1,000', async () => {
  const keys = Array.from({ length: 2500 }, (_, n) => `snmp:trap:k${n}`);
  const finds: number[] = []; const updates: number[] = [];
  const prisma = { operationalAlert: {
    findUnique: async () => null,
    findMany: async (args: any) => { finds.push(args.where.dedupKey.in.length); return args.where.dedupKey.in.map((key: string) => ({ id: key, siteId: null })); },
    updateMany: async (args: any) => { updates.push(args.where.id.in.length); return { count: args.where.id.in.length }; },
  } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  (service as any).publish = async () => undefined;
  const outcome = await service.reconcileSource('SNMP_TRAP', [], undefined, false, keys);
  assert.deepEqual(finds, [1000, 1000, 500]);
  assert.deepEqual(updates, [1000, 1000, 500]);
  assert.equal(outcome.resolved, 2500);
});

test('collectTrapAlerts loads boot traps in any status by device or source IP and they block the clear', async () => {
  const down = trap('linkDown Gi1/0/1', 30);
  const up = trap('linkUp Gi1/0/1', 10);
  const open = [{ id: 'a1', dedupKey: `snmp:trap:${down.id}`, entityId: down.id }];
  const clean = await collectTrapAlerts(fakeDb([down], open, [up]) as never, new Date(Date.now() - 24 * 3600_000));
  assert.deepEqual(clean.resolveKeys, [`snmp:trap:${down.id}`]);
  const db = fakeDb([down], open, [up], [bootTrap(20)]);
  const blocked = await collectTrapAlerts(db as never, new Date(Date.now() - 24 * 3600_000));
  // the boot blocks the clear: the port stays alerted under its per-port key; only the legacy per-trap key is retired
  assert.deepEqual(blocked.resolveKeys, [`snmp:trap:${down.id}`]);
  assert.deepEqual(blocked.candidates.map((candidate) => candidate.dedupKey), ['snmp:trap:device:dev-1:interface:9']);
  const bootArgs = db.calls.find((args) => args.where?.trapOid?.in?.includes('1.3.6.1.6.3.1.1.5.1'));
  assert.equal(bootArgs.where.status, undefined, 'no status filter: PENDING/UNMATCHED/DISCOVERED boots count');
  assert.deepEqual(bootArgs.where.trapOid.in, ['1.3.6.1.6.3.1.1.5.1', '1.3.6.1.6.3.1.1.5.2']);
  assert.deepEqual(bootArgs.where.AND[0].OR, [{ deviceId: { in: ['dev-1'] } }, { sourceAddress: { in: ['192.0.2.10'] } }]);
  assert.deepEqual(bootArgs.where.AND[1].OR, [{ category: null }, { category: { not: 'SELF_TEST' } }]);
  assert.ok(bootArgs.where.receivedAt.gte instanceof Date);
});

test('collectTrapAlerts caps the recovery lookback at 30 days and warns when paging stops', async () => {
  const ancient = trap('linkDown Gi1/0/1', 60 * 24 * 90); // 90 days old, alert still open
  const warnings: string[] = [];
  const original = Logger.prototype.warn;
  Logger.prototype.warn = function (message: any) { warnings.push(String(message)); } as never;
  try {
    let recoveryArgs: any;
    const rows = (take: number) => Array.from({ length: take }, (_, n) => ({ id: `a${n}`, dedupKey: `x${n}`, entityId: n === 0 ? ancient.id : null }));
    const db = {
      snmpTrapEvent: { findMany: async (args: any) => {
        if (args.where?.id?.in) return [ancient];
        if (args.where?.status === 'PROCESSED') { recoveryArgs = args; return []; }
        return [];
      } },
      operationalAlert: { findMany: async (args: any) => rows(args.take) }, // always more rows → hits MAX_PAGES
    };
    await collectTrapAlerts(db as never, new Date(Date.now() - 24 * 3600_000));
    const lookback = Date.now() - recoveryArgs.where.receivedAt.gte.getTime();
    assert.ok(lookback <= 30 * 24 * 3600_000 + 5000 && lookback >= 30 * 24 * 3600_000 - 5000, `lookback ${lookback}`);
    assert.ok(!recoveryArgs.where.trapOid.in.includes('1.3.6.1.6.3.1.1.5.1'), 'boot traps use their own query');
    assert.ok(recoveryArgs.select.uptimeTicks);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /open SNMP_TRAP alerts: stopped after 40 pages/);
  } finally { Logger.prototype.warn = original; }
});

test('pageAll does not warn at exactly 40 × 500 rows, only when a further row exists', async () => {
  const warnings: string[] = [];
  const original = Logger.prototype.warn;
  Logger.prototype.warn = function (message: any) { warnings.push(String(message)); } as never;
  try {
    const takes: number[] = [];
    let served = 0;
    const db = {
      snmpTrapEvent: { findMany: async () => [] },
      // exactly 20,000 open alerts in total
      operationalAlert: { findMany: async (args: any) => { takes.push(args.take); const n = Math.min(args.take, 20_000 - served); served += n; return Array.from({ length: n }, (_, i) => ({ id: `o${served - n + i}`, dedupKey: `x${i}`, entityId: null })); } },
    };
    await collectTrapAlerts(db as never, new Date(Date.now() - 24 * 3600_000));
    assert.equal(takes.length, 40);
    assert.equal(takes[39], 501, 'last page fetches one extra row');
    assert.equal(warnings.length, 0);
  } finally { Logger.prototype.warn = original; }
});

// ---- SNMP Phase 1 step 1.1: no age-based resolve ----

test('regression: an open alert whose trap is older than 24 h stays open (no 24 h auto-resolve)', async () => {
  const removed = trap('fru removed', 26 * 60); // 26 h old, no recovery since
  const oldDown = trap('linkDown Gi1/0/1', 30 * 60); // 30 h old uplink down, no linkUp since
  const open = [
    { id: 'a-fru', dedupKey: `snmp:trap:${removed.id}`, entityId: removed.id, occurrenceCount: 1 },
    { id: 'a-port', dedupKey: 'snmp:trap:device:dev-1:interface:9', entityId: oldDown.id, occurrenceCount: 4 },
  ];
  // nothing WARNING+ in the last 24 h: the window query returns no rows, older traps load by id
  const db = fakeDb([removed, oldDown], open, []);
  (db.snmpTrapEvent as any).findMany = async (args: any) => args.where?.id?.in ? [removed, oldDown].filter((item) => args.where.id.in.includes(item.id)) : [];
  const result = await collectTrapAlerts(db as never, new Date(Date.now() - 24 * 3600_000));
  assert.equal(result.resolveMissing, false, 'never resolve by absence');
  assert.deepEqual(result.resolveKeys, []);
  assert.deepEqual(result.candidates.map((candidate) => candidate.dedupKey).sort(), [`snmp:trap:${removed.id}`, 'snmp:trap:device:dev-1:interface:9'].sort());
  assert.equal(result.candidates.find((candidate) => candidate.dedupKey.endsWith(':interface:9'))?.occurrenceCount, 4, 'count never goes down');

  // through reconcileSource the alerts stay OPEN
  const statuses = new Map(open.map((alert) => [alert.dedupKey, 'OPEN']));
  const prisma = { operationalAlert: {
    findUnique: async ({ where }: any) => ({ id: where.dedupKey, status: statuses.get(where.dedupKey), severity: 'HIGH' }),
    update: async ({ where }: any) => ({ id: where.id, severity: 'HIGH', lastOccurredAt: new Date() }),
    findMany: async () => { throw new Error('resolveMissing must stay off'); },
    updateMany: async () => { throw new Error('must not resolve'); },
  } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  (service as any).publish = async () => undefined;
  assert.deepEqual(await service.reconcileSource('SNMP_TRAP', result.candidates, undefined, result.resolveMissing, result.resolveKeys), { active: 2, resolved: 0 });
});

test('an old problem still resolves on its real clear', async () => {
  const oldDown = trap('linkDown Gi1/0/1', 30 * 60);
  const up = trap('linkUp Gi1/0/1', 5);
  const db = fakeDb([oldDown], [{ id: 'a-port', dedupKey: 'snmp:trap:device:dev-1:interface:9', entityId: oldDown.id }], [up]);
  (db.snmpTrapEvent as any).findMany = async (args: any) => args.where?.id?.in ? [oldDown] : args.where?.status === 'PROCESSED' && !args.cursor ? [up] : [];
  const result = await collectTrapAlerts(db as never, new Date(Date.now() - 24 * 3600_000));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.resolveKeys, ['snmp:trap:device:dev-1:interface:9']);
});

// ---- SNMP Phase 1 step 2.1: one alert per port, uplinks only ----

const otherPort = (minutesAgo: number) => trap('linkDown Gi1/0/1', minutesAgo, { trapOid: '1.3.6.1.6.3.1.1.5.3', varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.11', type: 2, value: 11 }] });

test('a flapping uplink raises one HIGH alert with an occurrence count', async () => {
  const downs = [trap('linkDown Gi1/0/1', 50), trap('linkDown Gi1/0/1', 30), trap('linkDown Gi1/0/1', 10)];
  const ups = [trap('linkUp Gi1/0/1', 40), trap('linkUp Gi1/0/1', 20)];
  const result = await collectTrapAlerts(fakeDb(downs, [], ups) as never, new Date(Date.now() - 24 * 3600_000));
  assert.equal(result.candidates.length, 1);
  const [alert] = result.candidates;
  assert.equal(alert.dedupKey, 'snmp:trap:device:dev-1:interface:9');
  assert.equal(alert.severity, 'HIGH');
  assert.equal(alert.occurrenceCount, 3);
  assert.equal(alert.entityId, downs[2].id, 'points at the latest linkDown');
  assert.match(alert.detail, /3 ocorrências/);
  // the latest linkDown is followed by a linkUp: the whole port group clears
  const cleared = await collectTrapAlerts(fakeDb(downs, [{ id: 'a', dedupKey: alert.dedupKey, entityId: downs[2].id }], [...ups, trap('linkUp Gi1/0/1', 5)]) as never, new Date(Date.now() - 24 * 3600_000));
  assert.deepEqual(cleared.candidates, []);
  assert.deepEqual(cleared.resolveKeys, [alert.dedupKey]);
});

test('only uplinks alert: other ports, non-network peers and unmapped ports are stored without an alert', async () => {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const access = otherPort(10);
  const legacy = [{ id: 'a-legacy', dedupKey: `snmp:trap:${access.id}`, entityId: access.id }];
  const notUplink = await collectTrapAlerts(fakeDb([access], legacy, []) as never, cutoff);
  assert.deepEqual(notUplink.candidates, []);
  assert.deepEqual(notUplink.resolveKeys, [`snmp:trap:${access.id}`], 'a pre-Phase-1 alert on an access port is retired');
  const toServer = await collectTrapAlerts(fakeDb([trap('linkDown Gi1/0/1', 10)], [], [], [], uplinkDb([UPLINK], 'SERVER')) as never, cutoff);
  assert.deepEqual(toServer.candidates, [], 'a link to a server is not an uplink');
  const noTopology = await collectTrapAlerts(fakeDb([trap('linkDown Gi1/0/1', 10)], [], [], [], uplinkDb([])) as never, cutoff);
  assert.deepEqual(noTopology.candidates, []);
  // ifName match when the poll has not mapped the ifIndex yet
  const byName = { ...UPLINK, ifIndex: 999 };
  const named = trap('linkDown Gi1/0/1', 10);
  const decoded = decodeTrap(named.trapOid, named.varbinds);
  const nameDb = uplinkDb([{ ...byName, name: String(decoded.fields.ifName) }]);
  assert.equal(decoded.fields.ifName, 'GigabitEthernet1/0/1');
  assert.equal((await collectTrapAlerts(fakeDb([named], [], [], [], nameDb) as never, cutoff)).candidates.length, 1);
  // non-port traps are unaffected by the uplink rule
  assert.equal((await collectTrapAlerts(fakeDb([trap('fru removed', 10)], [], [], [], uplinkDb([])) as never, cutoff)).candidates.length, 1);
});

test('a pre-Phase-1 per-trap uplink alert moves to the per-port key', async () => {
  const down = trap('linkDown Gi1/0/1', 10);
  const result = await collectTrapAlerts(fakeDb([down], [{ id: 'a-legacy', dedupKey: `snmp:trap:${down.id}`, entityId: down.id }], []) as never, new Date(Date.now() - 24 * 3600_000));
  assert.deepEqual(result.candidates.map((candidate) => candidate.dedupKey), ['snmp:trap:device:dev-1:interface:9']);
  assert.deepEqual(result.resolveKeys, [`snmp:trap:${down.id}`]);
});
