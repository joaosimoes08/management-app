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
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({ topologyMap: { updateMany: async (args: any) => { increments.push(args); return { count: 1 }; } }, deviceConnection: { findFirst: async () => null, update: async ({ data }: any) => { updated = true; return data; } } }),
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
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({ topologyMap: { updateMany: async () => ({ count: 0 }) }, deviceConnection: { findFirst: async () => null, update: async () => { updated = true; } } }),
  };
  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const service = new TopologyService(prisma as never, access as never, {} as never, { record: async () => undefined } as never);
  await assert.rejects(service.updateStandaloneConnection(user, 'connection', { label: 'stale', expectedRevisions: { 'map-a': 3 } }), (error: any) => error.getStatus() === 409);
  assert.equal(updated, false);
});

test('standalone connection update validates interface ownership before saving ports', async () => {
  let saved: any;
  const prisma = {
    deviceConnection: { findUnique: async () => ({ id: 'connection', siteId: 'site', sourceDeviceId: 'a', targetDeviceId: 'b', maps: [] }) },
    device: { findMany: async () => [{ id: 'a', siteId: 'site' }, { id: 'b', siteId: 'site' }] },
    deviceInterface: { findMany: async () => [{ id: 'port-a', deviceId: 'a' }, { id: 'port-b', deviceId: 'b' }] },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({ topologyMap: { updateMany: async () => ({ count: 1 }) }, deviceConnection: { findFirst: async () => null, update: async ({ data }: any) => { saved = data; return data; } } }),
  };
  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const service = new TopologyService(prisma as never, access as never, {} as never, { record: async () => undefined } as never);
  await service.updateStandaloneConnection(user, 'connection', { sourceInterfaceId: 'port-a', targetInterfaceId: 'port-b', notes: 'Panel PP-01, porta 12' });
  assert.deepEqual(saved, { sourceInterfaceId: 'port-a', targetInterfaceId: 'port-b', notes: 'Panel PP-01, porta 12' });
  await assert.rejects(
    service.updateStandaloneConnection(user, 'connection', { sourceInterfaceId: 'port-b' }),
    (error: any) => error.getStatus() === 404,
  );
  assert.deepEqual(saved, { sourceInterfaceId: 'port-a', targetInterfaceId: 'port-b', notes: 'Panel PP-01, porta 12' });
});

test('topology connection creation rejects a port already used by another connection', async () => {
  let created = false;
  const prisma = {
    topologyMap: { findUnique: async () => ({ id: 'map', siteId: 'site', type: 'PHYSICAL', revision: 4, nodes: [{ deviceId: 'source' }, { deviceId: 'target' }], connections: [] }) },
    topologyMapNode: { findMany: async () => [{ deviceId: 'source' }, { deviceId: 'target' }] },
    device: { findMany: async () => [{ id: 'source', siteId: 'site' }, { id: 'target', siteId: 'site' }] },
    deviceInterface: { findMany: async () => [{ id: 'source-port', deviceId: 'source' }, { id: 'target-port', deviceId: 'target' }] },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({
      topologyMap: { updateMany: async () => ({ count: 1 }) },
      deviceConnection: {
        findFirst: async ({ where }: any) => {
          assert.deepEqual(where.OR, [
            { sourceInterfaceId: { in: ['source-port', 'target-port'] } },
            { targetInterfaceId: { in: ['source-port', 'target-port'] } },
          ]);
          return { id: 'existing-connection' };
        },
        create: async () => { created = true; },
      },
    }),
  };
  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const service = new TopologyService(prisma as never, access as never, {} as never, { record: async () => undefined } as never);
  await assert.rejects(
    service.createConnection(user, 'map', { sourceDeviceId: 'source', targetDeviceId: 'target', sourceInterfaceId: 'source-port', targetInterfaceId: 'target-port', revision: 4 }),
    (error: any) => error.getStatus() === 409,
  );
  assert.equal(created, false);
});

test('standalone connection update rejects a port already used by a different connection', async () => {
  let updated = false;
  const prisma = {
    deviceConnection: { findUnique: async () => ({ id: 'connection', siteId: 'site', sourceDeviceId: 'a', targetDeviceId: 'b', sourceInterfaceId: 'old-a', targetInterfaceId: 'old-b', maps: [] }) },
    device: { findMany: async () => [{ id: 'a', siteId: 'site' }, { id: 'b', siteId: 'site' }] },
    deviceInterface: { findMany: async () => [{ id: 'new-a', deviceId: 'a' }] },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({
      topologyMap: { updateMany: async () => ({ count: 1 }) },
      deviceConnection: {
        findFirst: async ({ where }: any) => {
          assert.equal(where.id.not, 'connection');
          assert.deepEqual(where.OR, [
            { sourceInterfaceId: { in: ['new-a', 'old-b'] } },
            { targetInterfaceId: { in: ['new-a', 'old-b'] } },
          ]);
          return { id: 'other-connection' };
        },
        update: async () => { updated = true; },
      },
    }),
  };
  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const service = new TopologyService(prisma as never, access as never, {} as never, { record: async () => undefined } as never);
  await assert.rejects(
    service.updateStandaloneConnection(user, 'connection', { sourceInterfaceId: 'new-a' }),
    (error: any) => error.getStatus() === 409,
  );
  assert.equal(updated, false);
});
