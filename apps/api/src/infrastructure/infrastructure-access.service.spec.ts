import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InfrastructureAccessService } from './infrastructure-access.service';

const user = { id: 'user', externalId: 'external', username: 'operator', roles: ['SYSTEMS_OPERATOR'] };
const building = { id: 'building', siteId: 'site' };
const room = { id: 'room', buildingId: 'building', building: { siteId: 'site' } };
const otherRoom = { id: 'other-room', buildingId: 'building', building: { siteId: 'site' } };

function service(rules: any[], memberships = ['group']) {
  const prisma = {
    accessGroupMember: { findMany: async () => memberships.map((groupId) => ({ groupId, group: { siteAssignments: [{ siteId: 'site' }] } })) },
    accessGroupSite: { findUnique: async () => ({ groupId: 'group', siteId: 'site' }), findMany: async () => memberships.map((groupId) => ({ groupId, siteId: 'site' })) },
    accessGroupSitePermission: { findMany: async () => [] },
    infrastructurePermission: { findMany: async ({ where }: any) => rules.filter((rule) => !where?.OR || where.OR.some((entry: any) => entry.scopeType === rule.scopeType && (entry.scopeId === rule.scopeId || entry.scopeId?.in?.includes(rule.scopeId)))) },
    site: { findUnique: async () => ({ id: 'site' }), findMany: async () => [{ id: 'site' }] },
    building: { findUnique: async () => building, findMany: async () => [{ ...building, rooms: [{ id: room.id }, { id: otherRoom.id }] }] },
    room: { findUnique: async ({ where }: any) => where.id === room.id ? room : otherRoom, findMany: async () => [room, otherRoom], findFirst: async ({ where }: any) => where.buildingId === building.id && where.id.in.includes(room.id) ? { id: room.id } : null },
  };
  return new InfrastructureAccessService(prisma as never, { record: async () => undefined } as never);
}

test('denies access when no infrastructure ACL applies', async () => {
  await assert.rejects(() => service([]).assertRoom(user as never, 'READ', room.id), NotFoundException);
  await assert.rejects(() => service([]).assertRoom(user as never, 'UPDATE', room.id), NotFoundException);
});

test('inherits Site actions and non-read actions imply read', async () => {
  const access = service([{ groupId: 'group', scopeType: 'SITE', scopeId: 'site', permission: 'UPDATE' }]);
  await access.assertRoom(user as never, 'READ', room.id);
  await access.assertRoom(user as never, 'UPDATE', room.id);
  await assert.rejects(() => access.assertRoom(user as never, 'CREATE', room.id), ForbiddenException);
});

test('a room matrix replaces the complete building matrix', async () => {
  const access = service([
    { groupId: 'group', scopeType: 'BUILDING', scopeId: building.id, permission: 'UPDATE' },
    { groupId: 'other', scopeType: 'ROOM', scopeId: room.id, permission: 'READ' },
  ]);
  await assert.rejects(() => access.assertRoom(user as never, 'READ', room.id), NotFoundException);
  await access.assertRoom(user as never, 'UPDATE', otherRoom.id);
});

test('READ on a room never permits CREATE', async () => {
  const access = service([{ groupId: 'group', scopeType: 'ROOM', scopeId: room.id, permission: 'READ' }]);
  await access.assertRoom(user as never, 'READ', room.id);
  await assert.rejects(() => access.assertRoom(user as never, 'CREATE', room.id), ForbiddenException);
  await assert.rejects(() => access.assertBuilding(user as never, 'CREATE', building.id), ForbiddenException);
});

test('admin bypasses configured infrastructure scopes', async () => {
  await service([], []).assertRoom({ ...user, roles: ['ADMIN'] } as never, 'DELETE', room.id);
});

test('a group never grants infrastructure access without an active application role', async () => {
  const access = service([{ groupId: 'group', scopeType: 'ROOM', scopeId: room.id, permission: 'READ' }]);
  await assert.rejects(() => access.assertRoom({ ...user, roles: [] } as never, 'READ', room.id), NotFoundException);
});
