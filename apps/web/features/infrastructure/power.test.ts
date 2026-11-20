import { describe, expect, it } from 'vitest';
import { devicePowerFields, emptyRackPower, rackPowerChanged, rackPowerDraft, rackPowerInput } from './forms';
import {
  assignOutlets, defaultPlugRows, deviceWatts, existingPlugRows, formatWatts, nextFreeOutlet, pduView, powerLevel,
  rackPowerTotals, wattsSourceFromApi, withoutPduConnection,
} from './power';
import type { Rack, RackPdu } from './types';

const supplier = (connections: RackPdu['connections'] = [], extra: Partial<RackPdu> = {}): RackPdu => ({ id: 'pdu-s', rackId: 'r', source: 'SUPPLIER', outletCount: 32, budgetWatts: 3680, connections, ...extra });
const ups = (connections: RackPdu['connections'] = [], extra: Partial<RackPdu> = {}): RackPdu => ({ id: 'pdu-u', rackId: 'r', source: 'UPS', outletCount: 32, budgetWatts: 3680, connections, ...extra });

describe('power defaults and outlets', () => {
  it('puts every plug on the supplier when the rack has no UPS', () => {
    expect(defaultPlugRows(3, [supplier()], 'd')).toEqual([
      { plugIndex: 1, pduId: 'pdu-s', outletIndex: 1 },
      { plugIndex: 2, pduId: 'pdu-s', outletIndex: 2 },
      { plugIndex: 3, pduId: 'pdu-s', outletIndex: 3 },
    ]);
  });

  it('alternates supplier / UPS starting with plug 1 on the supplier, on the next free outlet', () => {
    const pdus = [supplier([{ deviceId: 'x', deviceName: 'X', outlets: [{ outletIndex: 1, plugIndex: 1 }, { outletIndex: 3, plugIndex: 2 }] }]), ups()];
    expect(defaultPlugRows(3, pdus, 'd')).toEqual([
      { plugIndex: 1, pduId: 'pdu-s', outletIndex: 2 },
      { plugIndex: 2, pduId: 'pdu-u', outletIndex: 1 },
      { plugIndex: 3, pduId: 'pdu-s', outletIndex: 4 },
    ]);
  });

  it('leaves a plug unplugged when its PDU is full', () => {
    const full = supplier([{ deviceId: 'x', deviceName: 'X', outlets: [1, 2] }], { outletCount: 2 });
    expect(nextFreeOutlet(full, 'd')).toBeNull();
    expect(defaultPlugRows(1, [full], 'd')).toEqual([{ plugIndex: 1, pduId: '', outletIndex: null }]);
  });

  it('keeps valid explicit outlets and re-picks clashing ones', () => {
    const rows = assignOutlets([
      { plugIndex: 1, pduId: 'pdu-s', outletIndex: 5 },
      { plugIndex: 2, pduId: 'pdu-s', outletIndex: 5 },
    ], [supplier()], 'd');
    expect(rows.map((row) => row.outletIndex)).toEqual([5, 1]);
  });

  it('reads existing rows for a connected device, other plugs unplugged', () => {
    const pdus = [supplier([{ deviceId: 'd', deviceName: 'D', outlets: [{ outletIndex: 7, plugIndex: 2 }] }]), ups()];
    expect(existingPlugRows(2, pdus, 'd')).toEqual([
      { plugIndex: 1, pduId: '', outletIndex: null },
      { plugIndex: 2, pduId: 'pdu-s', outletIndex: 7 },
    ]);
  });
});

describe('power levels and formatting', () => {
  it('is amber at 80% and red at 100% of outlets or over budget', () => {
    expect(powerLevel({ used: 25, total: 32, watts: 0, budget: 3680 })).toBe('ok');
    expect(powerLevel({ used: 26, total: 32, watts: 0, budget: 3680 })).toBe('warn');
    expect(powerLevel({ used: 32, total: 32, watts: 0, budget: 3680 })).toBe('over');
    expect(powerLevel({ used: 1, total: 32, watts: 2944, budget: 3680 })).toBe('warn');
    expect(powerLevel({ used: 1, total: 32, watts: 3700, budget: 3680 })).toBe('over');
    expect(powerLevel({ used: 1, total: 32, watts: 3700, budget: null })).toBe('ok');
  });

  it('formats estimates with "~", 10 W rounding and kW from 1000 W', () => {
    expect(formatWatts(347, 'en')).toBe('~350 W');
    expect(formatWatts(2412, 'en')).toBe('~2.4 kW');
    expect(formatWatts(2412, 'pt-PT')).toBe('~2,4 kW');
  });

  it('maps API value sources', () => {
    expect(wattsSourceFromApi('manual')).toBe('manual');
    expect(wattsSourceFromApi('modelo')).toBe('model');
    expect(wattsSourceFromApi('padrão')).toBe('default');
  });

  it('prefers the API device power summary', () => {
    expect(deviceWatts({ type: 'SERVER', estimatedWatts: 100, power: { deviceId: 'd', plugCount: 2, plugCountSource: 'modelo', estimatedWatts: 420, wattsSource: 'modelo', connectedPlugs: 2, redundant: true, assignments: [] } })).toEqual({ watts: 420, source: 'model' });
  });
});

describe('rack power views', () => {
  const rack: Pick<Rack, 'pdus' | 'devices' | 'power'> = {
    devices: [],
    pdus: [
      supplier([
        { deviceId: 'a', deviceName: 'A', outlets: [{ outletIndex: 1, plugIndex: 1 }], deviceEstimatedWatts: 400 },
        { deviceId: 'b', deviceName: 'B', outlets: [{ outletIndex: 2, plugIndex: 1 }], deviceEstimatedWatts: 200 },
      ]),
      ups([{ deviceId: 'a', deviceName: 'A', outlets: [{ outletIndex: 1, plugIndex: 2 }], deviceEstimatedWatts: 400 }]),
    ],
  };

  it('splits a dual-fed device by plugs and computes failover', () => {
    const view = pduView(rack.pdus![0], rack);
    expect(view.used).toBe(2);
    expect(view.watts).toBe(400);
    expect(view.failoverWatts).toBe(600);
    expect(view.connections.find((item) => item.deviceId === 'a')?.dualFed).toBe(true);
  });

  it('has no failover line when nothing on the PDU is dual-fed', () => {
    const single = { devices: [], pdus: [supplier([{ deviceId: 'b', deviceName: 'B', outlets: [1], deviceEstimatedWatts: 200 }])] };
    expect(pduView(single.pdus[0], single).failoverWatts).toBeNull();
  });

  it('totals per feed, and keeps only feeds with a PDU from the API totals', () => {
    expect(rackPowerTotals(rack)).toEqual({ total: 600, bySource: { SUPPLIER: 400, UPS: 200 } });
    const api = { ...rack, pdus: [rack.pdus![0]], power: { mode: 'SUPPLIER_ONLY' as const, totals: { estimatedWatts: 900, bySource: { SUPPLIER: 900, UPS: 0 }, unconnectedDeviceIds: [] } } };
    expect(rackPowerTotals(api)).toEqual({ total: 900, bySource: { SUPPLIER: 900 } });
  });

  it('removes a connection optimistically and drops the stale failover on the other feed', () => {
    const withTotals = { ...rack, pdus: rack.pdus!.map((pdu) => ({ ...pdu, usedOutlets: pdu.connections!.length, estimatedWatts: 300, failoverWatts: 500 })) };
    const next = withoutPduConnection(withTotals, 'pdu-u', 'a');
    expect(next.pdus![1].connections).toEqual([]);
    expect(next.pdus![1].usedOutlets).toBe(0);
    expect(next.pdus![0].failoverWatts).toBeUndefined();
  });
});

describe('power form helpers', () => {
  it('sends UPS settings only with a UPS, empty name/budget as null', () => {
    const draft = { ...emptyRackPower(), supplier: { name: ' ', outletCount: '24', budgetWatts: '' } };
    expect(rackPowerInput(draft)).toEqual({ mode: 'SUPPLIER_ONLY', supplier: { name: null, outletCount: 24, budgetWatts: null } });
    expect(rackPowerInput({ ...draft, mode: 'SUPPLIER_AND_UPS' }).ups).toEqual({ name: null, outletCount: 32, budgetWatts: 3680 });
  });

  it('detects power changes against the saved draft', () => {
    const saved = rackPowerDraft({ pdus: [supplier()], powerMode: 'SUPPLIER_ONLY' });
    expect(rackPowerChanged(saved, saved)).toBe(false);
    expect(rackPowerChanged({ ...saved, mode: 'SUPPLIER_AND_UPS' }, saved)).toBe(true);
  });

  it('sends only changed device power fields, null to inherit again', () => {
    expect(devicePowerFields({ powerPlugCount: '', estimatedWatts: '250' })).toEqual({ estimatedWatts: 250 });
    expect(devicePowerFields({ powerPlugCount: '2', estimatedWatts: '', savedPower: { plugs: '2', watts: '300' } })).toEqual({ estimatedWatts: null });
  });
});
