import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IpamAccessService } from './ipam-access.service';

const user = { id: 'user', externalId: 'external', username: 'network', roles: ['NETWORK_OPERATOR'] };
function service(assignments: { siteId: string; permissions: string[] }[]) {
  const prisma = {
    accessGroupMember: { findMany: async () => assignments.length ? [{ group: { siteAssignments: assignments.map((item) => ({ siteId: item.siteId, permissions: item.permissions.map((permission) => ({ permission })) })) } }] : [] },
    site: { findUnique: async ({ where }: any) => ({ id: where.id }) },
    subnet: { findUnique: async ({ where }: any) => ({ id: where.id, siteId: where.id === 'subnet-b' ? 'site-b' : 'site-a', vlanId: null, vrfId: null }) },
    vlan: { findUnique: async ({ where }: any) => ({ id: where.id, siteId: 'site-a' }) },
    vrf: { findUnique: async ({ where }: any) => ({ id: where.id, siteId: 'site-a' }) },
    ipAddress: { findUnique: async () => null }, host: { findUnique: async () => null },
  };
  return new IpamAccessService(prisma as never);
}

test('denies IPAM access when the user has no Site assignment', async () => {
  await assert.rejects(() => service([]).assertContext(user as never, 'READ', { siteId: 'site-a' }), NotFoundException);
  await assert.rejects(() => service([]).assertContext(user as never, 'UPDATE', { siteId: 'site-a' }), NotFoundException);
});

test('a Site action applies to every IPAM descendant in that Site', async () => {
  const access = service([{ siteId: 'site-a', permissions: ['UPDATE'] }]);
  await access.assertContext(user as never, 'READ', { siteId: 'site-a', subnetId: 'subnet-a' });
  await access.assertContext(user as never, 'UPDATE', { siteId: 'site-a', vlanId: 'vlan-a' });
  await assert.rejects(() => access.assertContext(user as never, 'CREATE', { siteId: 'site-a' }), ForbiddenException);
  await assert.rejects(() => access.assertContext(user as never, 'READ', { siteId: 'site-b' }), NotFoundException);
});

test('Site membership exposes the Site picker without exposing IPAM descendants', async () => {
  const access = service([{ siteId: 'site-a', permissions: [] }]);
  assert.deepEqual(await access.whereFor(user as never, 'READ', 'site'), { id: { in: ['site-a'] } });
  assert.deepEqual(await access.whereFor(user as never, 'READ', 'subnet'), { siteId: { in: [] } });
});

test('unions Site actions from multiple groups without crossing Sites', async () => {
  const access = service([{ siteId: 'site-a', permissions: ['READ'] }, { siteId: 'site-b', permissions: ['UPDATE'] }]);
  assert.deepEqual(await access.whereFor(user as never, 'READ', 'subnet'), { siteId: { in: ['site-a', 'site-b'] } });
  assert.deepEqual(await access.whereFor(user as never, 'UPDATE', 'vlan'), { siteId: { in: ['site-b'] } });
  await assert.rejects(() => access.assertContext(user as never, 'UPDATE', { siteId: 'site-a' }), ForbiddenException);
});

test('admin bypasses Site grants', async () => {
  assert.deepEqual(await service([]).whereFor({ ...user, roles: ['ADMIN'] } as never, 'DELETE', 'subnet'), {});
});

test('a group never grants access without an active application role', async () => {
  const access = service([{ siteId: 'site-a', permissions: ['READ', 'UPDATE'] }]);
  const roleless = { ...user, roles: [] };
  assert.deepEqual(await access.whereFor(roleless as never, 'READ', 'site'), { id: { in: [] } });
  await assert.rejects(() => access.assertContext(roleless as never, 'READ', { siteId: 'site-a' }), NotFoundException);
});

test('a systems role can select its Site but cannot read IPAM records', async () => {
  const access = service([{ siteId: 'site-a', permissions: ['READ', 'UPDATE'] }]);
  const systems = { ...user, roles: ['SYSTEMS_OPERATOR'] };
  assert.deepEqual(await access.whereFor(systems as never, 'READ', 'site'), { id: { in: ['site-a'] } });
  assert.deepEqual(await access.whereFor(systems as never, 'READ', 'subnet'), { siteId: { in: [] } });
  await assert.rejects(() => access.assertContext(systems as never, 'READ', { siteId: 'site-a' }), NotFoundException);
});
