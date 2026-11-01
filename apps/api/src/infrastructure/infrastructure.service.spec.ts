import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { InfrastructureService } from './infrastructure.service';
import { ConflictException } from '@nestjs/common';

const user = { id: 'user-1', username: 'operator', roles: ['SYSTEMS_OPERATOR'] } as any;
const visibleDeviceWhere = { OR: [{ rackId: null }, { rack: { roomId: { in: ['room-allowed'] } } }] };

function service() {
  const calls: { findUnique?: any; findMany?: any; visibleUser?: any } = {};
  const prisma = {
    deviceModel: {
      findUnique: async (args: any) => { calls.findUnique = args; return { id: 'model-1', devices: [] }; },
      findMany: async (args: any) => { calls.findMany = args; return []; },
    },
  } as any;
  const access = { visibleRoomIds: async (value: any) => { calls.visibleUser = value; return ['room-allowed']; } } as any;
  const ipamAccess = { assertIp: async () => ({ subnet: { siteId: 'site-b' } }) } as any;
  return { subject: new InfrastructureService(prisma, {} as any, access, ipamAccess), calls };
}

test('filters devices nested in model detail by visible rooms', async () => {
  const { subject, calls } = service();
  await subject.getModel('model-1', user);

  assert.equal(calls.visibleUser, user);
  assert.deepEqual(calls.findUnique.where, { id: 'model-1' });
  assert.deepEqual(calls.findUnique.include.devices, { where: visibleDeviceWhere });
});

test('filters model device counts by visible rooms', async () => {
  const { subject, calls } = service();
  await subject.listModels(user);

  assert.deepEqual(calls.findMany.include._count, { select: { devices: { where: visibleDeviceWhere } } });
});

test('rejects a management IP from another Site', async () => {
  const { subject } = service();
  await assert.rejects(
    () => (subject as any).validateManagementIp(user, 'ip-site-b', 'site-a'),
    ConflictException,
  );
});

function placementService(targetSiteId = 'site-a') {
  const sourceRack = {
    id: 'rack-source', name: 'Source', units: 6, roomId: 'room-a',
    room: { id: 'room-a', building: { siteId: 'site-a' } },
    devices: [{ id: 'device-1', name: 'Router', rackUnitStart: 5, rackUnitSize: 1, status: 'ACTIVE' }],
  };
  const targetRack = {
    id: 'rack-target', name: 'Target', units: 6, roomId: 'room-b',
    room: { id: 'room-b', building: { siteId: targetSiteId } },
    devices: [],
  };
  const prisma = {
    device: { findUnique: async () => ({
      id: 'device-1', name: 'Router', rackId: 'rack-source', rackUnitStart: 5, rackUnitSize: 1,
      rack: { roomId: 'room-a', room: { building: { siteId: 'site-a' } } },
    }) },
    rack: {
      findUnique: async () => targetRack,
      findMany: async () => [sourceRack, targetRack],
    },
  } as any;
  return { subject: new InfrastructureService(prisma, {} as any, {} as any, {} as any), prisma };
}

test('plans placement into a different room within the same Site', async () => {
  const { subject, prisma } = placementService();
  const plan = await (subject as any).buildDevicePlacementPlan(prisma, 'device-1', { rackId: 'rack-target', rackUnitStart: 2 });
  assert.equal(plan.target.rackId, 'rack-target');
  assert.equal(plan.target.rackUnitStart, 2);
});

test('rejects a placement into a rack in a different Site', async () => {
  const { subject, prisma } = placementService('site-b');
  await assert.rejects(
    () => (subject as any).buildDevicePlacementPlan(prisma, 'device-1', { rackId: 'rack-target', rackUnitStart: 2 }),
    ConflictException,
  );
});

test('reports a concurrent placement change as a clear conflict', async () => {
  const prisma = { $transaction: async () => { throw Object.assign(new Error('transaction conflict'), { code: 'P2034' }); } } as any;
  const access = {
    assertDevice: async () => ({ type: 'SWITCH' }),
    assertRack: async () => undefined,
  } as any;
  const subject = new InfrastructureService(prisma, {} as any, access, {} as any);
  await assert.rejects(
    () => subject.placeDevice('device-1', { rackId: 'rack-target', rackUnitStart: 2 }, user),
    (error: unknown) => error instanceof ConflictException && error.message.includes('A localização foi alterada'),
  );
});
