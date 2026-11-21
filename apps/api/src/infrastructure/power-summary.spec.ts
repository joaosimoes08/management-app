import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { summarizeRackPower, type PduInput, type PowerDeviceInput } from './power/rack-power';
import { buildRackPowerSummary, buildSitePowerSummary, parseThresholds, thresholdLevel } from './power/power-summary';

const rack = { id: 'rack-1', name: 'R1', roomId: 'room-1', roomName: 'Sala', buildingName: 'Ed' };
const pdu = (id: string, source: 'SUPPLIER' | 'UPS', budgetWatts: number | null, outletCount: number, outlets: PduInput['outlets']): PduInput => ({ id, rackId: 'rack-1', source, name: id, outletCount, budgetWatts, outlets });
const dev = (id: string, watts: number, plugs = 2): PowerDeviceInput => ({ id, name: id.toUpperCase(), type: 'SERVER', estimatedWatts: watts, powerPlugCount: plugs });
const view = (pdus: PduInput[], devices: PowerDeviceInput[], thresholds = parseThresholds()) => buildRackPowerSummary({ rack, devices, power: summarizeRackPower(pdus, devices) }, thresholds);

test('parseThresholds defaults to 80/90 and rejects bad or inverted values', () => {
  assert.deepEqual(parseThresholds(), { warningPercent: 80, criticalPercent: 90 });
  assert.deepEqual(parseThresholds('70', '95'), { warningPercent: 70, criticalPercent: 95 });
  for (const [w, c] of [['0', '90'], ['abc', undefined], ['90', '90'], ['95', '90'], [undefined, '201']] as const) assert.throws(() => parseThresholds(w, c), BadRequestException);
});

test('thresholdLevel: >= warning is warning, >= critical is critical, no budget is ok', () => {
  const t = parseThresholds();
  assert.equal(thresholdLevel(79, 100, t), 'ok');
  assert.equal(thresholdLevel(80, 100, t), 'warning');
  assert.equal(thresholdLevel(90, 100, t), 'critical');
  assert.equal(thresholdLevel(500, null, t), 'ok');
  assert.equal(thresholdLevel(1, 0, t), 'critical');
});

test('redundant rack: capacity per feed, failover worst case, near-limit PDUs and devices', () => {
  // srv-a 1700 W and srv-b 1000 W on both feeds; srv-c 300 W only on SUPPLIER; srv-d unconnected.
  const pdus = [
    pdu('pdu-s', 'SUPPLIER', 3000, 4, [{ outletIndex: 1, deviceId: 'srv-a', plugIndex: 1 }, { outletIndex: 2, deviceId: 'srv-b', plugIndex: 1 }, { outletIndex: 3, deviceId: 'srv-c', plugIndex: 1 }, { outletIndex: 4, deviceId: 'srv-c', plugIndex: 2 }]),
    pdu('pdu-u', 'UPS', 3000, 32, [{ outletIndex: 1, deviceId: 'srv-a', plugIndex: 2 }, { outletIndex: 2, deviceId: 'srv-b', plugIndex: 2 }]),
  ];
  const summary = view(pdus, [dev('srv-a', 1700), dev('srv-b', 1000), dev('srv-c', 300), dev('srv-d', 200)]);
  assert.equal(summary.mode, 'SUPPLIER_AND_UPS');
  assert.deepEqual(summary.capacity, { watts: 6000, bySource: { SUPPLIER: 3000, UPS: 3000 }, missingBudgetPduIds: [] });
  assert.deepEqual(summary.draw, { estimatedWatts: 3000, bySource: { SUPPLIER: 1650, UPS: 1350 }, worstFailoverWatts: 3000 });
  assert.deepEqual(summary.utilisation, { bySource: { SUPPLIER: 55, UPS: 45 }, worstFailoverPercent: 100 });
  const supplier = summary.pdus.find((item) => item.id === 'pdu-s')!;
  assert.deepEqual(supplier.levels, { watts: 'ok', failoverWatts: 'critical', outlets: 'critical' });
  const ups = summary.pdus.find((item) => item.id === 'pdu-u')!;
  assert.equal(ups.failoverPercent, 90); // 2700 / 3000
  assert.equal(ups.level, 'critical');
  assert.equal(summary.level, 'critical');
  assert.deepEqual(summary.nearLimit.pdus.map((item) => [item.id, item.reasons]), [['pdu-s', ['failoverWatts', 'outlets']], ['pdu-u', ['failoverWatts']]]);
  assert.deepEqual(summary.nearLimit.devices.map((item) => [item.id, item.pduIds]), [['srv-a', ['pdu-s', 'pdu-u']], ['srv-b', ['pdu-s', 'pdu-u']], ['srv-c', ['pdu-s']]]);
  assert.deepEqual(summary.devices.unconnected, [{ id: 'srv-d', name: 'SRV-D' }]);
  assert.deepEqual(summary.devices.nonRedundant, [{ id: 'srv-c', name: 'SRV-C' }]);
  assert.equal(summary.devices.connected, 3);
  assert.deepEqual(summary.outlets, { used: 6, total: 36, free: 30, percent: 16.7, level: 'ok' });
});

test('custom thresholds move levels; missing budget makes capacity unknown', () => {
  const pdus = [pdu('pdu-s', 'SUPPLIER', null, 10, [{ outletIndex: 1, deviceId: 'a', plugIndex: 1 }])];
  const summary = view(pdus, [dev('a', 5000, 1), dev('b', 100, 0)], parseThresholds('5', '50'));
  assert.equal(summary.capacity.watts, null);
  assert.deepEqual(summary.capacity.missingBudgetPduIds, ['pdu-s']);
  assert.equal(summary.utilisation.bySource.SUPPLIER, null);
  assert.equal(summary.pdus[0].levels.watts, 'ok');
  assert.equal(summary.pdus[0].levels.outlets, 'warning'); // 10 % >= 5 %
  assert.deepEqual(summary.devices.unconnected, []); // b needs no power
  assert.deepEqual(summary.devices.nonRedundant, []); // supplier-only rack
  const partial = view([pdu('p', 'SUPPLIER', 3680, 32, [{ outletIndex: 1, deviceId: 'a', plugIndex: 1 }])], [dev('a', 100, 2)]);
  assert.deepEqual(partial.devices.partiallyConnected, [{ id: 'a', name: 'A', connectedPlugs: 1, plugCount: 2 }]);
});

test('site summary sorts worst first and totals racks', () => {
  const t = parseThresholds();
  const calm = view([pdu('p1', 'SUPPLIER', 3000, 32, [{ outletIndex: 1, deviceId: 'a', plugIndex: 1 }])], [dev('a', 300, 1)]);
  const hot = buildRackPowerSummary({ rack: { ...rack, id: 'rack-2', name: 'R2' }, devices: [dev('b', 2900, 1)], power: summarizeRackPower([{ ...pdu('p2', 'SUPPLIER', 3000, 32, [{ outletIndex: 1, deviceId: 'b', plugIndex: 1 }]), rackId: 'rack-2' }], [dev('b', 2900, 1)]) }, t);
  const site = buildSitePowerSummary('site-1', [calm, hot], t, false);
  assert.deepEqual(site.racks.map((item) => item.rack.id), ['rack-2', 'rack-1']);
  assert.deepEqual(site.totals.byLevel, { ok: 1, warning: 0, critical: 1 });
  assert.equal(site.totals.capacityWatts, 6000);
  assert.equal(site.totals.estimatedWatts, 3200);
  assert.equal(site.totals.pdusNearLimit, 1);
  assert.equal(site.truncated, false);
});
