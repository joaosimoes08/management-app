import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { InfrastructureService } from './infrastructure.service';

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
  return { subject: new InfrastructureService(prisma, {} as any, access), calls };
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
