import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InfrastructureService } from './infrastructure.service';
import { attachRackPower, RackPowerService } from './power/rack-power.service';

const user = { id: 'user-1', username: 'operator', roles: ['SYSTEMS_OPERATOR'] } as any;
const conflictCode = (code: string) => (error: unknown) => error instanceof ConflictException && (error.getResponse() as { code?: string }).code === code;

type Assignment = { id: string; pduId: string; outletIndex: number; deviceId: string; plugIndex: number };
type Pdu = { id: string; rackId: string; source: 'SUPPLIER' | 'UPS'; name: string | null; outletCount: number; budgetWatts: number | null };
type Dev = { id: string; name: string; type: string; rackId: string | null; powerPlugCount: number | null; estimatedWatts: number | null; model: { powerPlugCount: number | null; typicalWatts: number | null; maxWatts: number | null } | null };

/** Tiny in-memory Prisma stand-in covering exactly the calls the power code makes. */
function fakeDb(seed: { pdus: Pdu[]; devices: Dev[]; assignments: Assignment[] }) {
  const db = { pdus: [...seed.pdus], devices: seed.devices.map((d) => ({ ...d })), assignments: [...seed.assignments], audits: [] as any[], locks: [] as string[] };
  let seq = 0;
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
    if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt;
    return row[key] === value;
  });
  const deviceView = (d: Dev) => ({ ...d });
  const pduWithOutlets = (pdu: Pdu, outletWhere?: any, withDevice = false) => ({ ...pdu, outlets: db.assignments.filter((a) => a.pduId === pdu.id && matches(a, outletWhere)).map((a) => ({ outletIndex: a.outletIndex, deviceId: a.deviceId, plugIndex: a.plugIndex, ...(withDevice ? { device: { name: db.devices.find((d) => d.id === a.deviceId)?.name } } : {}) })) });
  const client: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { db.locks.push(strings.join('?') + values.join(',')); return []; },
    rack: {
      findUnique: async ({ where }: any) => {
        if (!db.pdus.some((p) => p.rackId === where.id) && !db.devices.some((d) => d.rackId === where.id) && where.id !== 'rack-empty') return null;
        return { id: where.id, pdus: db.pdus.filter((p) => p.rackId === where.id).map((p) => pduWithOutlets(p)), devices: db.devices.filter((d) => d.rackId === where.id).map(deviceView) };
      },
    },
    rackPdu: {
      findMany: async ({ where, include }: any) => db.pdus.filter((p) => p.rackId === where.rackId).map((p) => pduWithOutlets(p, include?.outlets?.where, !!include?.outlets?.select?.device)),
      findUnique: async ({ where }: any) => db.pdus.find((p) => p.id === where.id) ?? null,
      create: async ({ data }: any) => { const row = { id: `pdu-${++seq}`, name: null, ...data }; db.pdus.push(row); return row; },
      update: async ({ where, data }: any) => { const row = db.pdus.find((p) => p.id === where.id)!; Object.assign(row, data); return row; },
      delete: async ({ where }: any) => { db.pdus = db.pdus.filter((p) => p.id !== where.id); db.assignments = db.assignments.filter((a) => a.pduId !== where.id); },
    },
    device: {
      findUnique: async ({ where }: any) => { const d = db.devices.find((item) => item.id === where.id); return d ? deviceView(d) : null; },
      update: async ({ where, data }: any) => { const d = db.devices.find((item) => item.id === where.id)!; Object.assign(d, data); return d; },
    },
    pduOutletAssignment: {
      findMany: async ({ where }: any) => db.assignments.filter((a) => matches(a, where)),
      count: async ({ where }: any) => db.assignments.filter((a) => matches(a, where)).length,
      deleteMany: async ({ where }: any) => { const before = db.assignments.length; db.assignments = db.assignments.filter((a) => !matches(a, where)); return { count: before - db.assignments.length }; },
      createMany: async ({ data }: any) => {
        for (const item of data) {
          if (db.assignments.some((a) => a.pduId === item.pduId && a.outletIndex === item.outletIndex)) throw Object.assign(new Error('unique'), { code: 'P2002' });
          db.assignments.push({ id: `a-${++seq}`, ...item });
        }
        return { count: data.length };
      },
    },
  };
  client.$transaction = async (fn: any) => {
    const snapshot = { pdus: db.pdus.map((p) => ({ ...p })), devices: db.devices.map((d) => ({ ...d })), assignments: [...db.assignments] };
    try { return await fn(client); } catch (error) { Object.assign(db, snapshot); throw error; }
  };
  const audit = { recordInTransaction: async (_tx: any, entry: any) => { db.audits.push(entry); }, record: async (entry: any) => { db.audits.push(entry); } };
  const accessCalls: any[] = [];
  const access = {
    assertRack: async (...args: any[]) => { accessCalls.push(['rack', ...args.slice(1)]); },
    assertDevice: async (...args: any[]) => { accessCalls.push(['device', ...args.slice(1)]); return db.devices.find((d) => d.id === args[2]); },
  };
  return { db, client, audit, access, accessCalls };
}

const supplier: Pdu = { id: 'rede-1', rackId: 'rack-1', source: 'SUPPLIER', name: null, outletCount: 4, budgetWatts: 3680 };
const ups: Pdu = { id: 'ups-1', rackId: 'rack-1', source: 'UPS', name: null, outletCount: 4, budgetWatts: 3680 };
const otherRackPdu: Pdu = { id: 'rede-2', rackId: 'rack-2', source: 'SUPPLIER', name: null, outletCount: 32, budgetWatts: 3680 };
const dev = (id: string, rackId: string | null, extra: Partial<Dev> = {}): Dev => ({ id, name: id.toUpperCase(), type: 'SERVER', rackId, powerPlugCount: null, estimatedWatts: null, model: null, ...extra });

function powerService(seed: Parameters<typeof fakeDb>[0]) {
  const fake = fakeDb(seed);
  return { ...fake, subject: new RackPowerService(fake.client, fake.audit as any, fake.access as any) };
}

test('PUT devices/:id/power without plugs auto-splits Rede/UPS, replaces old assignments and audits in the transaction', async () => {
  const { subject, db } = powerService({ pdus: [supplier, ups], devices: [dev('srv', 'rack-1'), dev('sw', 'rack-1')], assignments: [{ id: 'x', pduId: 'rede-1', outletIndex: 1, deviceId: 'sw', plugIndex: 1 }, { id: 'old', pduId: 'rede-1', outletIndex: 3, deviceId: 'srv', plugIndex: 1 }] });
  const result = await subject.updateDevicePower('srv', {}, user);
  assert.deepEqual(db.assignments.filter((a) => a.deviceId === 'srv').map((a) => [a.pduId, a.outletIndex, a.plugIndex]), [['rede-1', 2, 1], ['ups-1', 1, 2]]);
  assert.equal(result.mode, 'SUPPLIER_AND_UPS');
  assert.deepEqual(result.device?.assignments.map((a) => a.source), ['SUPPLIER', 'UPS']);
  assert.equal(result.device?.redundant, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(db.audits.at(-1).action, 'DEVICE_POWER_UPDATED');
  assert.equal(db.audits.at(-1).metadata.removedAssignments, 1);
  assert.ok(db.locks.some((sql) => sql.includes('"RackPdu"') && sql.includes('FOR UPDATE')));
});

test('PUT devices/:id/power stores plug count/watts overrides and warns when plugs do not fit', async () => {
  const full: Pdu = { ...supplier, outletCount: 2 };
  const { subject, db } = powerService({ pdus: [full], devices: [dev('srv', 'rack-1'), dev('sw', 'rack-1')], assignments: [{ id: 'x', pduId: 'rede-1', outletIndex: 1, deviceId: 'sw', plugIndex: 1 }] });
  const result = await subject.updateDevicePower('srv', { powerPlugCount: 3, estimatedWatts: 600 }, user);
  assert.equal(db.devices.find((d) => d.id === 'srv')!.estimatedWatts, 600);
  assert.equal(result.device?.plugCount, 3);
  assert.equal(result.device?.connectedPlugs, 1);
  assert.deepEqual(result.unplugged, [{ plugIndex: 2, reason: 'NO_FREE_OUTLET', pduId: 'rede-1' }, { plugIndex: 3, reason: 'NO_FREE_OUTLET', pduId: 'rede-1' }]);
  assert.deepEqual(result.warnings, ['NO_FREE_OUTLET', 'PLUGS_NOT_CONNECTED', 'NO_REDUNDANT_FEED']);
  assert.equal(result.pdus[0].connections.find((c) => c.deviceId === 'srv')!.wattsSource, 'manual');
});

test('PUT devices/:id/power rejects a double-booked outlet, a PDU of another rack, and a device outside a rack — without partial writes', async () => {
  const seed = { pdus: [supplier, otherRackPdu], devices: [dev('srv', 'rack-1'), dev('sw', 'rack-1'), dev('loose', null)], assignments: [{ id: 'x', pduId: 'rede-1', outletIndex: 1, deviceId: 'sw', plugIndex: 1 }, { id: 'keep', pduId: 'rede-1', outletIndex: 4, deviceId: 'srv', plugIndex: 1 }] };
  const { subject, db } = powerService(seed);
  await assert.rejects(() => subject.updateDevicePower('srv', { estimatedWatts: 999, plugs: [{ plugIndex: 1, pduId: 'rede-1', outletIndex: 1 }] }, user), conflictCode('PDU_OUTLET_TAKEN'));
  await assert.rejects(() => subject.updateDevicePower('srv', { plugs: [{ plugIndex: 1, pduId: 'rede-2' }] }, user), conflictCode('PDU_NOT_IN_RACK'));
  await assert.rejects(() => subject.updateDevicePower('loose', {}, user), conflictCode('DEVICE_NOT_IN_RACK'));
  assert.deepEqual(db.assignments.map((a) => a.id), ['x', 'keep']);
  assert.equal(db.devices.find((d) => d.id === 'srv')!.estimatedWatts, null);
  assert.equal(db.audits.length, 0);
});

test('PUT devices/:id/power maps a concurrent unique-constraint race to 409 PDU_OUTLET_TAKEN', async () => {
  const { subject, client } = powerService({ pdus: [supplier], devices: [dev('srv', 'rack-1')], assignments: [] });
  client.pduOutletAssignment.createMany = async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); };
  await assert.rejects(() => subject.updateDevicePower('srv', {}, user), conflictCode('PDU_OUTLET_TAKEN'));
});

test('PUT devices/:id/power with plugs: [] may not clear configured outlets (400 REQUIRED_CONFIG_MISSING, CLEARED) and writes nothing', async () => {
  const { subject, db } = powerService({ pdus: [supplier], devices: [dev('srv', 'rack-1')], assignments: [{ id: 'old', pduId: 'rede-1', outletIndex: 1, deviceId: 'srv', plugIndex: 1 }] });
  await assert.rejects(() => subject.updateDevicePower('srv', { plugs: [] }, user), (error: any) => {
    const body = error.getResponse();
    assert.equal(error.getStatus(), 400);
    assert.equal(body.code, 'REQUIRED_CONFIG_MISSING');
    assert.deepEqual(body.details.errors.map((item: any) => [item.config, item.reason, item.tab]), [['power', 'CLEARED', 'energia']]);
    return true;
  });
  assert.deepEqual(db.assignments.map((a) => a.id), ['old']);
});

test('PUT devices/:id/power with plugs: [] is allowed for a legacy device that had no outlets, and with 0 plugs ("sem alimentação")', async () => {
  const legacy = powerService({ pdus: [supplier], devices: [dev('srv', 'rack-1')], assignments: [] });
  const result = await legacy.subject.updateDevicePower('srv', { plugs: [] }, user);
  assert.deepEqual(result.unplugged.map((u) => u.reason), ['NOT_REQUESTED', 'NOT_REQUESTED']);
  const passive = powerService({ pdus: [supplier], devices: [dev('pp', 'rack-1')], assignments: [{ id: 'old', pduId: 'rede-1', outletIndex: 1, deviceId: 'pp', plugIndex: 1 }] });
  await passive.subject.updateDevicePower('pp', { powerPlugCount: 0, plugs: [] }, user);
  assert.equal(passive.db.assignments.length, 0);
  assert.equal(passive.db.devices[0].powerPlugCount, 0);
});

test('DELETE racks/:rackId/pdus/:pduId/devices/:deviceId frees only that PDU and audits; 404 for a PDU of another rack', async () => {
  const { subject, db } = powerService({ pdus: [supplier, ups, otherRackPdu], devices: [dev('srv', 'rack-1')], assignments: [{ id: 'a', pduId: 'rede-1', outletIndex: 1, deviceId: 'srv', plugIndex: 1 }, { id: 'b', pduId: 'ups-1', outletIndex: 1, deviceId: 'srv', plugIndex: 2 }] });
  const result = await subject.disconnectDevice('rack-1', 'ups-1', 'srv', user);
  assert.equal(result.removed, 1);
  assert.deepEqual(db.assignments.map((a) => a.id), ['a']);
  assert.equal(result.pdus.find((p) => p.source === 'UPS')!.usedOutlets, 0);
  assert.equal(db.audits.at(-1).action, 'DEVICE_POWER_DISCONNECTED');
  await assert.rejects(() => subject.disconnectDevice('rack-1', 'rede-2', 'srv', user), NotFoundException);
});

test('DELETE disconnect checks rack permission scoped to the device type and locks device + PDUs; a scoped user cannot unplug other types', async () => {
  const { subject, db, accessCalls } = powerService({ pdus: [supplier], devices: [dev('srv', 'rack-1'), dev('sw', 'rack-1', { type: 'SWITCH' })], assignments: [{ id: 'a', pduId: 'rede-1', outletIndex: 1, deviceId: 'srv', plugIndex: 1 }, { id: 'b', pduId: 'rede-1', outletIndex: 2, deviceId: 'sw', plugIndex: 1 }] });
  // Network-only operator: may edit SWITCH devices in the rack, nothing else.
  (subject as any).access.assertRack = async (...args: any[]) => {
    accessCalls.push(['rack', ...args.slice(1)]);
    if (args[3] !== 'DEVICE' || args[4] !== 'SWITCH') throw new ForbiddenException('Sem permissão');
  };
  await assert.rejects(() => subject.disconnectDevice('rack-1', 'rede-1', 'srv', user), ForbiddenException);
  assert.deepEqual(db.assignments.map((a) => a.id), ['a', 'b']);
  assert.equal(db.audits.length, 0);
  const result = await subject.disconnectDevice('rack-1', 'rede-1', 'sw', user);
  assert.equal(result.removed, 1);
  assert.deepEqual(db.assignments.map((a) => a.id), ['a']);
  assert.deepEqual(accessCalls.map((c) => c.slice(1)), [['UPDATE', 'rack-1', 'DEVICE', 'SERVER'], ['UPDATE', 'rack-1', 'DEVICE', 'SWITCH']]);
  assert.ok(db.locks.some((sql) => sql.includes('"Device"') && sql.includes('FOR UPDATE')));
  assert.ok(db.locks.some((sql) => sql.includes('"RackPdu"') && sql.includes('FOR UPDATE')));
  await assert.rejects(() => subject.disconnectDevice('rack-1', 'rede-1', 'ghost', user), NotFoundException);
});

test('PUT racks/:id/pdus adds a UPS, then refuses to remove it while connected and refuses shrinking below used outlets', async () => {
  const { subject, db } = powerService({ pdus: [{ ...supplier, outletCount: 32 }], devices: [dev('srv', 'rack-1')], assignments: [{ id: 'a', pduId: 'rede-1', outletIndex: 10, deviceId: 'srv', plugIndex: 1 }] });
  const added = await subject.updateRackPdus('rack-1', { mode: 'SUPPLIER_AND_UPS', ups: { name: 'UPS A', budgetWatts: 2000 } }, user);
  assert.equal(added.mode, 'SUPPLIER_AND_UPS');
  assert.deepEqual(added.pdus.map((p) => [p.source, p.name, p.outletCount, p.budgetWatts]), [['SUPPLIER', null, 32, 3680], ['UPS', 'UPS A', 32, 2000]]);
  const upsId = added.pdus[1].id;
  db.assignments.push({ id: 'u', pduId: upsId, outletIndex: 1, deviceId: 'srv', plugIndex: 2 });
  await assert.rejects(() => subject.updateRackPdus('rack-1', { mode: 'SUPPLIER_ONLY' }, user), conflictCode('PDU_HAS_CONNECTIONS'));
  await assert.rejects(() => subject.updateRackPdus('rack-1', { mode: 'SUPPLIER_AND_UPS', supplier: { outletCount: 8 } }, user), conflictCode('PDU_OUTLETS_IN_USE'));
  assert.equal(db.pdus.length, 2);
  db.assignments = db.assignments.filter((a) => a.id !== 'u');
  const removed = await subject.updateRackPdus('rack-1', { mode: 'SUPPLIER_ONLY' }, user);
  assert.equal(removed.mode, 'SUPPLIER_ONLY');
  assert.deepEqual(db.audits.map((a) => a.action), ['RACK_POWER_UPDATED', 'RACK_POWER_UPDATED']);
});

test('attachRackPower adds powerMode, pdus summaries, totals and per-device power to a rack payload', () => {
  const rack = attachRackPower({ id: 'rack-1', pdus: [{ ...supplier, outlets: [{ outletIndex: 1, deviceId: 'srv', plugIndex: 1 }] }], devices: [dev('srv', 'rack-1', { estimatedWatts: 300 })] });
  assert.equal(rack.powerMode, 'SUPPLIER_ONLY');
  assert.equal(rack.pdus[0].estimatedWatts, 300);
  assert.deepEqual(rack.power.totals, { estimatedWatts: 300, bySource: { SUPPLIER: 300, UPS: 0 }, unconnectedDeviceIds: [] });
  assert.equal((rack.devices[0] as any).power.wattsSource, 'manual');
  assert.equal((rack.devices[0] as any).name, 'SRV');
});

// ── Cascades on device moves (InfrastructureService) ─────────────────────────

test('moving a device to another rack or out of a rack deletes its assignments; plug count reduction trims extra plugs', async () => {
  const { client, db } = fakeDb({ pdus: [supplier, otherRackPdu], devices: [dev('moved', 'rack-2'), dev('removed', null), dev('stay', 'rack-1', { powerPlugCount: 1 })], assignments: [
    { id: 'm1', pduId: 'rede-1', outletIndex: 1, deviceId: 'moved', plugIndex: 1 },
    { id: 'r1', pduId: 'rede-1', outletIndex: 2, deviceId: 'removed', plugIndex: 1 },
    { id: 's1', pduId: 'rede-1', outletIndex: 3, deviceId: 'stay', plugIndex: 1 },
    { id: 's2', pduId: 'rede-1', outletIndex: 4, deviceId: 'stay', plugIndex: 2 },
  ] });
  const infra = new InfrastructureService(client, {} as any, {} as any, {} as any) as any;
  assert.equal(await infra.releaseDevicePower(client, 'moved', 'rack-1'), 1);
  assert.equal(await infra.releaseDevicePower(client, 'removed', 'rack-1'), 1);
  assert.equal(await infra.releaseDevicePower(client, 'stay', 'rack-1'), 1);
  assert.deepEqual(db.assignments.map((a) => a.id), ['s1']);
});

test('placeDevice releases power only for devices that changed rack and records it in the audit metadata', async () => {
  const devices = new Map<string, any>([['d1', { id: 'd1', rackId: 'rack-1' }], ['d2', { id: 'd2', rackId: 'rack-2' }]]);
  const released: string[] = [];
  const tx: any = {
    device: {
      findUnique: async ({ where }: any) => ({ ...devices.get(where.id), powerPlugCount: null, model: null }),
      update: async ({ where, data }: any) => { Object.assign(devices.get(where.id), data); },
    },
    rack: { findUnique: async () => ({ room: { building: { siteId: 'site-a' } } }) },
    pduOutletAssignment: { deleteMany: async ({ where }: any) => { if (!where.plugIndex) released.push(where.deviceId); return { count: where.plugIndex ? 0 : 2 }; } },
  };
  const logs: any[] = [];
  const access = { assertDevice: async () => ({ type: 'SERVER' }), assertRack: async () => undefined };
  const prisma: any = { $transaction: async (fn: any) => fn(tx) };
  const infra = new InfrastructureService(prisma, { record: async (entry: any) => logs.push(entry) } as any, access as any, {} as any) as any;
  infra.buildDevicePlacementPlan = async () => ({ changes: [{ id: 'd1', rackId: 'rack-2', rackUnitStart: 1, rackUnitSize: 1, name: 'D1', rackName: 'R2', reason: 'MOVED' }, { id: 'd2', rackId: 'rack-2', rackUnitStart: 2, rackUnitSize: 1, name: 'D2', rackName: 'R2', reason: 'DISPLACED' }], target: {} });
  await infra.placeDevice('d1', { rackId: 'rack-2', rackUnitStart: 1 }, user);
  assert.deepEqual(released, ['d1']);
  assert.deepEqual(logs[0].metadata.powerReleased, [{ deviceId: 'd1', removed: 2 }]);
});
