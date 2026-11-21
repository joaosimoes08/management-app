import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DEFAULT_PDU_BUDGET_WATTS, DEFAULT_PDU_OUTLET_COUNT, DEFAULT_POWER_PLUG_COUNT, DEFAULT_WATTS_BY_DEVICE_TYPE, DEFAULT_WATTS_FALLBACK } from './power/power-defaults';
import { allocatePlugs, defaultPlugRequests, defaultWattsForType, initialPdus, outletLoadLevel, planPduSettings, resolveDeviceWatts, resolvePlugCount, summarizeRackPower, wattLoadLevel, type AllocationPdu, type PduInput } from './power/rack-power';

const conflictCode = (code: string) => (error: unknown) => error instanceof ConflictException && (error.getResponse() as { code?: string }).code === code;
const badRequestCode = (code: string) => (error: unknown) => error instanceof BadRequestException && (error.getResponse() as { code?: string }).code === code;
const pdu = (id: string, source: 'SUPPLIER' | 'UPS', taken: number[] = [], outletCount = 32): AllocationPdu => ({ id, source, outletCount, taken: new Set(taken) });

// ── Defaults and wattage resolution ──────────────────────────────────────────

test('defaults module carries the approved values', () => {
  assert.equal(DEFAULT_PDU_OUTLET_COUNT, 32);
  assert.equal(DEFAULT_PDU_BUDGET_WATTS, 3680);
  assert.equal(DEFAULT_POWER_PLUG_COUNT, 2);
  assert.deepEqual({ ...DEFAULT_WATTS_BY_DEVICE_TYPE }, { SWITCH: 150, ROUTER: 200, FIREWALL: 200, SERVER: 350, STORAGE: 500, PATCH_PANEL: 0, PASSIVE: 0, OTHER: 100 });
  assert.equal(DEFAULT_WATTS_FALLBACK, 100);
  assert.equal(defaultWattsForType('server'), 350);
  assert.equal(defaultWattsForType('UNKNOWN_KIND'), 100);
  assert.equal(defaultWattsForType('PATCH_PANEL'), 0);
});

test('watts resolve manual → modelo → padrão', () => {
  assert.deepEqual(resolveDeviceWatts({ type: 'SERVER', estimatedWatts: 420, model: { typicalWatts: 300 } }), { watts: 420, source: 'manual' });
  assert.deepEqual(resolveDeviceWatts({ type: 'SERVER', estimatedWatts: 0, model: { typicalWatts: 300 } }), { watts: 0, source: 'manual' });
  assert.deepEqual(resolveDeviceWatts({ type: 'SERVER', estimatedWatts: null, model: { typicalWatts: 300 } }), { watts: 300, source: 'modelo' });
  assert.deepEqual(resolveDeviceWatts({ type: 'SERVER', estimatedWatts: null, model: { typicalWatts: null } }), { watts: 350, source: 'padrão' });
  assert.deepEqual(resolveDeviceWatts({ type: 'SWITCH', model: null }), { watts: 150, source: 'padrão' });
});

test('plug count resolves device → model → default 2, and 0 is kept', () => {
  assert.deepEqual(resolvePlugCount({ powerPlugCount: 0, model: { powerPlugCount: 2 } }), { count: 0, source: 'manual' });
  assert.deepEqual(resolvePlugCount({ powerPlugCount: null, model: { powerPlugCount: 1 } }), { count: 1, source: 'modelo' });
  assert.deepEqual(resolvePlugCount({ model: null }), { count: 2, source: 'padrão' });
});

test('load levels: amber at 80 %, red at full outlets or over budget, null budget never warns', () => {
  assert.equal(outletLoadLevel(25, 32), 'ok');
  assert.equal(outletLoadLevel(26, 32), 'warning');
  assert.equal(outletLoadLevel(32, 32), 'critical');
  assert.equal(wattLoadLevel(2943, 3680), 'ok');
  assert.equal(wattLoadLevel(2944, 3680), 'warning');
  assert.equal(wattLoadLevel(3680, 3680), 'warning');
  assert.equal(wattLoadLevel(3681, 3680), 'critical');
  assert.equal(wattLoadLevel(99999, null), 'ok');
});

// ── Allocation ───────────────────────────────────────────────────────────────

test('default plug distribution: supplier only puts every plug on Rede', () => {
  assert.deepEqual(defaultPlugRequests(2, [pdu('rede', 'SUPPLIER')]), [{ plugIndex: 1, pduId: 'rede' }, { plugIndex: 2, pduId: 'rede' }]);
});

test('default plug distribution: Rede + UPS alternates plug 1 Rede, plug 2 UPS; 1 plug goes to Rede', () => {
  const pdus = [pdu('ups', 'UPS'), pdu('rede', 'SUPPLIER')];
  assert.deepEqual(defaultPlugRequests(3, pdus).map((item) => item.pduId), ['rede', 'ups', 'rede']);
  assert.deepEqual(defaultPlugRequests(1, pdus).map((item) => item.pduId), ['rede']);
  assert.deepEqual(defaultPlugRequests(0, pdus), []);
});

test('auto-pick takes the lowest free outlets, skipping other devices and explicit picks', () => {
  const result = allocatePlugs(3, [{ plugIndex: 1, pduId: 'rede' }, { plugIndex: 2, pduId: 'rede', outletIndex: 2 }, { plugIndex: 3, pduId: 'rede' }], [pdu('rede', 'SUPPLIER', [1, 3])]);
  assert.deepEqual(result.assignments, [{ plugIndex: 1, pduId: 'rede', outletIndex: 4 }, { plugIndex: 2, pduId: 'rede', outletIndex: 2 }, { plugIndex: 3, pduId: 'rede', outletIndex: 5 }]);
  assert.deepEqual(result.unplugged, []);
});

test('plugs that do not fit stay unplugged with NO_FREE_OUTLET; omitted and null plugs are NOT_REQUESTED', () => {
  const result = allocatePlugs(4, [{ plugIndex: 1, pduId: 'rede' }, { plugIndex: 2, pduId: 'rede' }, { plugIndex: 3, pduId: null }], [pdu('rede', 'SUPPLIER', [1, 2], 3)]);
  assert.deepEqual(result.assignments, [{ plugIndex: 1, pduId: 'rede', outletIndex: 3 }]);
  assert.deepEqual(result.unplugged, [{ plugIndex: 2, reason: 'NO_FREE_OUTLET', pduId: 'rede' }, { plugIndex: 3, reason: 'NOT_REQUESTED' }, { plugIndex: 4, reason: 'NOT_REQUESTED' }]);
});

test('409 PDU_OUTLET_TAKEN when an explicit outlet is used by another device or twice in one request', () => {
  assert.throws(() => allocatePlugs(1, [{ plugIndex: 1, pduId: 'rede', outletIndex: 5 }], [pdu('rede', 'SUPPLIER', [5])]), conflictCode('PDU_OUTLET_TAKEN'));
  assert.throws(() => allocatePlugs(2, [{ plugIndex: 1, pduId: 'rede', outletIndex: 7 }, { plugIndex: 2, pduId: 'rede', outletIndex: 7 }], [pdu('rede', 'SUPPLIER')]), conflictCode('PDU_OUTLET_TAKEN'));
});

test('409 PDU_NOT_IN_RACK when the PDU belongs to another rack', () => {
  assert.throws(() => allocatePlugs(1, [{ plugIndex: 1, pduId: 'other-rack-pdu' }], [pdu('rede', 'SUPPLIER')]), conflictCode('PDU_NOT_IN_RACK'));
});

test('400 for plug or outlet out of range and duplicated plugs', () => {
  assert.throws(() => allocatePlugs(2, [{ plugIndex: 3, pduId: 'rede' }], [pdu('rede', 'SUPPLIER')]), badRequestCode('POWER_PLUG_OUT_OF_RANGE'));
  assert.throws(() => allocatePlugs(0, [{ plugIndex: 1, pduId: 'rede' }], [pdu('rede', 'SUPPLIER')]), badRequestCode('POWER_PLUG_OUT_OF_RANGE'));
  assert.throws(() => allocatePlugs(2, [{ plugIndex: 1, pduId: 'rede' }, { plugIndex: 1, pduId: null }], [pdu('rede', 'SUPPLIER')]), badRequestCode('POWER_PLUG_DUPLICATED'));
  assert.throws(() => allocatePlugs(1, [{ plugIndex: 1, pduId: 'rede', outletIndex: 33 }], [pdu('rede', 'SUPPLIER')]), badRequestCode('PDU_OUTLET_OUT_OF_RANGE'));
});

// ── PDU settings ─────────────────────────────────────────────────────────────

const withOutlets = (id: string, source: 'SUPPLIER' | 'UPS', outlets: { outletIndex: number; deviceId: string; plugIndex: number; deviceName?: string }[]): PduInput & { outlets: typeof outlets } => ({ id, rackId: 'rack-1', source, name: null, outletCount: 32, budgetWatts: 3680, outlets });

test('new rack defaults to one 32-outlet / 3680 W supplier PDU; Rede + UPS adds a UPS PDU', () => {
  assert.deepEqual(initialPdus(), [{ source: 'SUPPLIER', name: null, outletCount: 32, budgetWatts: 3680 }]);
  assert.deepEqual(initialPdus({ mode: 'SUPPLIER_AND_UPS', ups: { name: 'PDU B', outletCount: 24, budgetWatts: null } }), [
    { source: 'SUPPLIER', name: null, outletCount: 32, budgetWatts: 3680 },
    { source: 'UPS', name: 'PDU B', outletCount: 24, budgetWatts: null },
  ]);
});

test('switching to Rede + UPS creates the UPS PDU and applies settings to the existing supplier PDU', () => {
  const plan = planPduSettings([withOutlets('rede', 'SUPPLIER', [])], { mode: 'SUPPLIER_AND_UPS', supplier: { budgetWatts: 7360, name: 'PDU A' } });
  assert.deepEqual(plan.create, [{ source: 'UPS', name: null, outletCount: 32, budgetWatts: 3680 }]);
  assert.deepEqual(plan.update, [{ id: 'rede', source: 'SUPPLIER', data: { name: 'PDU A', budgetWatts: 7360 } }]);
  assert.deepEqual(plan.delete, []);
});

test('409 PDU_HAS_CONNECTIONS when removing a UPS PDU that still has devices, listing them', () => {
  const current = [withOutlets('rede', 'SUPPLIER', []), withOutlets('ups', 'UPS', [{ outletIndex: 2, deviceId: 'd1', plugIndex: 2, deviceName: 'SRV-01' }, { outletIndex: 1, deviceId: 'd1', plugIndex: 1, deviceName: 'SRV-01' }])];
  assert.throws(() => planPduSettings(current, { mode: 'SUPPLIER_ONLY' }), (error: unknown) => {
    assert.ok(conflictCode('PDU_HAS_CONNECTIONS')(error));
    assert.deepEqual((error as ConflictException).getResponse(), { code: 'PDU_HAS_CONNECTIONS', message: (error as any).getResponse().message, details: { pduId: 'ups', source: 'UPS', devices: [{ deviceId: 'd1', deviceName: 'SRV-01', outlets: [1, 2] }] } });
    return true;
  });
  const empty = [withOutlets('rede', 'SUPPLIER', []), withOutlets('ups', 'UPS', [])];
  assert.deepEqual(planPduSettings(empty, { mode: 'SUPPLIER_ONLY' }).delete, [{ id: 'ups', source: 'UPS' }]);
});

test('409 PDU_OUTLETS_IN_USE when shrinking outlets below used outlets; shrinking above them is allowed', () => {
  const current = [withOutlets('rede', 'SUPPLIER', [{ outletIndex: 3, deviceId: 'd1', plugIndex: 1, deviceName: 'SW-01' }, { outletIndex: 20, deviceId: 'd2', plugIndex: 1, deviceName: 'SRV-02' }])];
  assert.throws(() => planPduSettings(current, { mode: 'SUPPLIER_ONLY', supplier: { outletCount: 16 } }), (error: unknown) => {
    assert.ok(conflictCode('PDU_OUTLETS_IN_USE')(error));
    assert.deepEqual((error as any).getResponse().details.devices, [{ deviceId: 'd2', deviceName: 'SRV-02', outlets: [20] }]);
    return true;
  });
  assert.deepEqual(planPduSettings(current, { mode: 'SUPPLIER_ONLY', supplier: { outletCount: 20 } }).update, [{ id: 'rede', source: 'SUPPLIER', data: { outletCount: 20 } }]);
});

// ── Split and failover maths ─────────────────────────────────────────────────

test('dual-fed device splits 50/50 and failover moves the full load to each PDU', () => {
  const pdus: PduInput[] = [
    { id: 'rede', rackId: 'r', source: 'SUPPLIER', name: null, outletCount: 32, budgetWatts: 3680, outlets: [{ outletIndex: 1, deviceId: 'srv', plugIndex: 1 }, { outletIndex: 2, deviceId: 'sw', plugIndex: 1 }] },
    { id: 'ups', rackId: 'r', source: 'UPS', name: null, outletCount: 32, budgetWatts: 1000, outlets: [{ outletIndex: 1, deviceId: 'srv', plugIndex: 2 }] },
  ];
  const devices = [
    { id: 'srv', name: 'SRV-01', type: 'SERVER', estimatedWatts: 500 },
    { id: 'sw', name: 'SW-01', type: 'SWITCH', model: { typicalWatts: 90 } },
    { id: 'pp', name: 'Patch', type: 'OTHER', powerPlugCount: 0 },
    { id: 'idle', name: 'Idle', type: 'ROUTER' },
  ];
  const summary = summarizeRackPower(pdus, devices);
  assert.equal(summary.mode, 'SUPPLIER_AND_UPS');
  const [rede, ups] = summary.pdus;
  assert.equal(rede.source, 'SUPPLIER');
  assert.equal(rede.usedOutlets, 2);
  assert.equal(rede.freeOutlets, 30);
  assert.equal(rede.estimatedWatts, 250 + 90);
  assert.equal(rede.failoverWatts, 500 + 90);
  assert.equal(ups.estimatedWatts, 250);
  assert.equal(ups.failoverWatts, 500);
  assert.deepEqual(rede.connections.map((item) => [item.deviceName, item.estimatedWattsShare, item.wattsSource]), [['SRV-01', 250, 'manual'], ['SW-01', 90, 'modelo']]);
  assert.deepEqual(summary.totals, { estimatedWatts: 590, bySource: { SUPPLIER: 340, UPS: 250 }, unconnectedDeviceIds: ['idle'] });
  const srv = summary.devices.find((item) => item.deviceId === 'srv')!;
  assert.equal(srv.redundant, true);
  assert.equal(srv.connectedPlugs, 2);
});

test('split follows connected plug count (3 plugs: 2 on Rede, 1 on UPS) and an unplugged plug does not dilute the load', () => {
  const pdus: PduInput[] = [
    { id: 'rede', rackId: 'r', source: 'SUPPLIER', name: null, outletCount: 32, budgetWatts: 3680, outlets: [{ outletIndex: 1, deviceId: 'st', plugIndex: 1 }, { outletIndex: 2, deviceId: 'st', plugIndex: 3 }, { outletIndex: 3, deviceId: 'half', plugIndex: 1 }] },
    { id: 'ups', rackId: 'r', source: 'UPS', name: null, outletCount: 32, budgetWatts: 3680, outlets: [{ outletIndex: 1, deviceId: 'st', plugIndex: 2 }] },
  ];
  const summary = summarizeRackPower(pdus, [{ id: 'st', name: 'ST', type: 'STORAGE', powerPlugCount: 3 }, { id: 'half', name: 'Half', type: 'SERVER' }]);
  assert.equal(summary.pdus[0].connections[0].estimatedWattsShare, 333);
  assert.equal(summary.pdus[1].connections[0].estimatedWattsShare, 167);
  assert.equal(summary.pdus[0].connections[1].estimatedWattsShare, 350);
  assert.equal(summary.devices.find((item) => item.deviceId === 'half')!.redundant, false);
});

test('budget levels flag normal and failover load separately', () => {
  const pdus: PduInput[] = [
    { id: 'rede', rackId: 'r', source: 'SUPPLIER', name: null, outletCount: 4, budgetWatts: 600, outlets: [{ outletIndex: 1, deviceId: 'a', plugIndex: 1 }, { outletIndex: 2, deviceId: 'b', plugIndex: 1 }] },
    { id: 'ups', rackId: 'r', source: 'UPS', name: null, outletCount: 4, budgetWatts: 600, outlets: [{ outletIndex: 1, deviceId: 'a', plugIndex: 2 }, { outletIndex: 2, deviceId: 'b', plugIndex: 2 }] },
  ];
  const summary = summarizeRackPower(pdus, [{ id: 'a', name: 'A', type: 'SERVER', estimatedWatts: 400 }, { id: 'b', name: 'B', type: 'SERVER', estimatedWatts: 400 }]);
  assert.deepEqual(summary.pdus[0].levels, { outlets: 'ok', watts: 'ok', failoverWatts: 'critical' });
  assert.equal(summary.pdus[0].estimatedWatts, 400);
  assert.equal(summary.pdus[0].failoverWatts, 800);
});
