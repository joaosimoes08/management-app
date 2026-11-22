import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { SiteCapacityService } from './site-capacity.service';
import { rackMeasurements, type CapacityRack } from './rack-capacity';

const now = new Date('2026-11-21T12:00:00Z');
const user = { roles: ['READ_ONLY'] } as never;
const thresholds = { warningPercent: 80, criticalPercent: 90 };
const rack: CapacityRack = {
  id: 'rack', name: 'Rack A', units: 20, roomId: 'room', room: { buildingId: 'building' },
  devices: [
    { id: 'd1', name: 'Device 1', type: 'SWITCH', rackUnitStart: 1, rackUnitSize: 2, estimatedWatts: 100, powerPlugCount: 1, model: null },
    { id: 'd2', name: 'Device 2', type: 'SWITCH', rackUnitStart: 2, rackUnitSize: 2, estimatedWatts: 200, powerPlugCount: 1, model: null },
  ],
  pdus: [{
    id: 'pdu', name: null, source: 'SUPPLIER', rackId: 'rack', outletCount: 8, budgetWatts: 400,
    updatedAt: now, createdAt: now, outlets: [{ deviceId: 'd2', outletIndex: 1, plugIndex: 1 }],
  }],
  unitReservations: [],
};

test('rack tracks distinct occupied U slots and reuses connected power estimates', () => {
  const [space, power, pdu] = rackMeasurements(rack);
  assert.deepEqual([space.used, space.total], [3, 20]);
  assert.deepEqual([power.used, power.total], [200, 400]);
  assert.deepEqual([pdu.used, pdu.total], [200, 400]);
  assert.equal(pdu.resourceKey, 'pdu:pdu');
});

test('Round 2 #18: active U reservations count as used rack space, without double-counting units a device already fills', () => {
  const [space] = rackMeasurements({ ...rack, unitReservations: [{ startUnit: 3, size: 3 }, { startUnit: 19, size: 4 }] });
  assert.ok(space.kind === 'RACK_SPACE');
  // Devices fill U1-3; reservations add U4-5 and U19-20 (clipped to the 20U rack).
  assert.deepEqual([space.used, space.total, space.reservedUnits], [7, 20, 4]);
  const [plain] = rackMeasurements(rack);
  assert.ok(plain.kind === 'RACK_SPACE');
  assert.equal(plain.reservedUnits, 0);
});

test('outlook checks Site access first and limits rack and subnet sources independently', async () => {
  const prisma = {
    subnet: { findMany: async () => { assert.fail('IPAM data queried without an IPAM grant'); } },
    netAppIntegration: { findUnique: async () => null },
    rack: { findMany: async (input: { where: object; select: { unitReservations: { where: unknown } } }) => {
      assert.deepEqual(input.where, { roomId: { in: ['room'] }, room: { building: { siteId: 'site' } } });
      assert.deepEqual(input.select.unitReservations.where, { releasedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
      return [rack];
    } },
    rackCapacitySample: { findMany: async () => [] },
  };
  const siteAccess = { assertSite: async () => undefined, visibleRoomIds: async () => ['room'] };
  const ipamAccess = { assertContext: async () => { throw new NotFoundException(); } };
  const svc = new SiteCapacityService(prisma as never, siteAccess as never, ipamAccess as never);
  const result = await svc.outlook('site', user, thresholds, now);
  assert.deepEqual(result.items.map(({ kind, currentPercent }) => [kind, currentPercent]), [['RACK_SPACE', 15], ['RACK_POWER', 50], ['PDU_POWER', 50]]);
  assert.equal(result.items[0].reservedUnits, 0);
  assert.equal('reservedUnits' in result.items[1], false);
  assert.ok(result.items.every((item) => item.status === 'INSUFFICIENT' && item.estimatedAt === null));

  const denied = new SiteCapacityService({} as never, { assertSite: async () => { throw new NotFoundException(); } } as never, {} as never);
  await assert.rejects(() => denied.outlook('site', user, thresholds, now), NotFoundException);
});
