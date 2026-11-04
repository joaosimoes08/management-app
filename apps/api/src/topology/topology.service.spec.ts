import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TopologyService } from './topology.service';

const user = { id: 'user', roles: ['ADMIN'] } as never;

test('standalone connection update increments every associated map revision atomically', async () => {
  const increments: any[] = []; let updated = false;
  const prisma = {
    deviceConnection: {
      findUnique: async () => ({ id: 'connection', siteId: 'site', sourceDeviceId: 'a', targetDeviceId: 'b', maps: [
        { mapId: 'map-a', map: { revision: 3 } }, { mapId: 'map-b', map: { revision: 8 } },
      ] }),
      update: async ({ data }: any) => { updated = true; return data; },
    },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({ topologyMap: { updateMany: async (args: any) => { increments.push(args); return { count: 1 }; } }, deviceConnection: { update: async ({ data }: any) => { updated = true; return data; } } }),
  };
  const audit = { record: async () => undefined };
  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const service = new TopologyService(prisma as never, access as never, {} as never, audit as never);
  await service.updateStandaloneConnection(user, 'connection', { label: 'renamed', expectedRevisions: { 'map-a': 3 } });
  assert.deepEqual(increments.map((item) => item.where), [{ id: 'map-a', revision: 3 }, { id: 'map-b', revision: 8 }]);
  assert.ok(increments.every((item) => item.data.revision.increment === 1));
  assert.equal(updated, true);
});

test('standalone connection update rejects a stale associated map revision without updating the connection', async () => {
  let updated = false;
  const prisma = {
    deviceConnection: { findUnique: async () => ({ id: 'connection', siteId: 'site', sourceDeviceId: 'a', targetDeviceId: 'b', maps: [{ mapId: 'map-a', map: { revision: 4 } }] }) },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({ topologyMap: { updateMany: async () => ({ count: 0 }) }, deviceConnection: { update: async () => { updated = true; } } }),
  };
  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const service = new TopologyService(prisma as never, access as never, {} as never, { record: async () => undefined } as never);
  await assert.rejects(service.updateStandaloneConnection(user, 'connection', { label: 'stale', expectedRevisions: { 'map-a': 3 } }), (error: any) => error.getStatus() === 409);
  assert.equal(updated, false);
});

test('physical topology connections require existing interfaces on both devices and reject an occupied port', async () => {
  const devices = [{ id: 'device-a', siteId: 'site' }, { id: 'device-b', siteId: 'site' }];
  let occupied: { id: string } | null = null;
  const prisma = {
    device: { findMany: async () => devices },
    deviceInterface: { findMany: async () => [{ id: 'port-a', deviceId: 'device-a' }, { id: 'port-b', deviceId: 'device-b' }] },
    deviceConnection: { findFirst: async () => occupied },
  };
  const service = new TopologyService(prisma as never, {} as never, {} as never, {} as never);
  await assert.rejects((service as any).validateConnectionEndpoints('site', { sourceDeviceId: 'device-a', targetDeviceId: 'device-b', type: 'PHYSICAL' }), (error: any) => error.getStatus() === 400);
  await assert.rejects((service as any).validateConnectionEndpoints('site', { sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceInterfaceId: 'port-a', targetInterfaceId: 'wrong-device-port', type: 'PHYSICAL' }), (error: any) => error.getStatus() === 404);
  occupied = { id: 'existing-link' };
  await assert.rejects((service as any).validateConnectionEndpoints('site', { sourceDeviceId: 'device-a', targetDeviceId: 'device-b', sourceInterfaceId: 'port-a', targetInterfaceId: 'port-b', type: 'PHYSICAL' }), (error: any) => error.getStatus() === 409);
});
