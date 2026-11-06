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

test('rolls back imported devices when an audit insert fails', async () => {
  const committed: any[] = [];
  let nextId = 0;
  const prisma = {
    device: { findFirst: async () => null },
    $transaction: async (work: (tx: any) => Promise<any>) => {
      const pending: any[] = [];
      const tx = {
        device: { create: async ({ data }: any) => { const item = { ...data, id: `device-${++nextId}` }; pending.push(item); return item; } },
        auditLog: { create: async () => { throw new Error('audit unavailable'); } },
      };
      const result = await work(tx);
      committed.push(...pending);
      return result;
    },
  } as any;
  const access = { assertSite: async () => undefined } as any;
  const audit = {
    recordInTransaction: (tx: any, input: any) => tx.auditLog.create({ data: input }),
    scheduleInventoryQualityReconcile: async () => undefined,
  } as any;
  const subject = new InfrastructureService(prisma, audit, access, {} as any);

  await assert.rejects(() => subject.importDevices('site-1', [{ name: 'Switch 1', type: 'SWITCH' }], user), ConflictException);
  assert.deepEqual(committed, []);
});

test('retires a device and records its audit entry atomically', async () => {
  const calls: string[] = [];
  const device = { id: 'device-1', status: 'RETIRED' };
  const prisma = {
    device: { findUnique: async () => ({ id: 'device-1', name: 'switch-1', interfaces: [], ipAddresses: [], topologyNodes: [] }) },
    $transaction: async (work: (tx: any) => Promise<any>) => work({
      device: { update: async () => { calls.push('device.update'); return device; } },
      auditLog: { create: async ({ data }: any) => { calls.push(`audit.create:${data.entityId}`); return data; } },
    }),
  } as any;
  const access = { assertDevice: async () => undefined } as any;
  const audit = { scheduleInventoryQualityReconcile: async () => { calls.push('reconcile'); } } as any;
  const subject = new InfrastructureService(prisma, audit, access, {} as any);

  const result = await subject.confirmDeviceRetirement('device-1', user, true);

  assert.deepEqual(result, { success: true, device });
  assert.deepEqual(calls, ['device.update', 'audit.create:device-1', 'reconcile']);
});
