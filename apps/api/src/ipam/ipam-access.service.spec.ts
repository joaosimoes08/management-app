import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IpamAccessService } from './ipam-access.service';

const baseUser = { id: 'user', externalId: 'external', username: 'operator', roles: ['NETWORK_OPERATOR'] };
function serviceWith(permissions: any[]) {
  const prisma = { ipamGroupMember: { findMany: async () => permissions.length ? [{ group: { permissions } }] : [] } };
  return new IpamAccessService(prisma as never);
}

test('keeps legacy role access when the user has no scoped permissions', async () => {
  await serviceWith([]).assertContext(baseUser as never, 'DELETE', { siteId: 'site-b' });
});

test('site permissions inherit to descendants and non-read actions imply read', async () => {
  const service = serviceWith([{ scopeType: 'SITE', scopeId: 'site-a', permission: 'UPDATE' }]);
  await service.assertContext(baseUser as never, 'READ', { siteId: 'site-a', subnetId: 'subnet-a' });
  await service.assertContext(baseUser as never, 'UPDATE', { siteId: 'site-a', subnetId: 'subnet-a' });
  await assert.rejects(() => service.assertContext(baseUser as never, 'UPDATE', { siteId: 'site-b' }), ForbiddenException);
});

test('admin bypasses scoped permissions', async () => {
  const service = serviceWith([{ scopeType: 'SITE', scopeId: 'site-a', permission: 'READ' }]);
  await service.assertContext({ ...baseUser, roles: ['ADMIN'] } as never, 'DELETE', { siteId: 'site-b' });
});

test('unions permissions from multiple groups and hides out-of-scope reads', async () => {
  const prisma = { ipamGroupMember: { findMany: async () => [
    { group: { permissions: [{ scopeType: 'SUBNET', scopeId: 'subnet-a', permission: 'READ' }] } },
    { group: { permissions: [{ scopeType: 'SUBNET', scopeId: 'subnet-b', permission: 'UPDATE' }] } },
  ] } };
  const service = new IpamAccessService(prisma as never);
  await service.assertContext(baseUser as never, 'READ', { subnetId: 'subnet-a' });
  await service.assertContext(baseUser as never, 'READ', { subnetId: 'subnet-b' });
  await assert.rejects(() => service.assertContext(baseUser as never, 'READ', { subnetId: 'subnet-c' }), NotFoundException);
});

test('exposes Site and VLAN ancestors needed to navigate to a scoped subnet', async () => {
  const service = serviceWith([{ scopeType: 'SUBNET', scopeId: 'subnet-a', permission: 'READ' }]);
  assert.deepEqual(await service.whereFor(baseUser as never, 'READ', 'site'), {
    OR: [
      { id: { in: [] } },
      { vrfs: { some: { id: { in: [] } } } },
      { vlans: { some: { id: { in: [] } } } },
      { subnets: { some: { OR: [{ id: { in: ['subnet-a'] } }, { vrfId: { in: [] } }, { vlanId: { in: [] } }] } } },
    ],
  });
  assert.deepEqual(await service.whereFor(baseUser as never, 'READ', 'vlan'), {
    OR: [
      { id: { in: [] } },
      { siteId: { in: [] } },
      { subnets: { some: { OR: [{ id: { in: ['subnet-a'] } }, { vrfId: { in: [] } }] } } },
    ],
  });
});

test('requires update permission on every subnet linked to a Host', async () => {
  const prisma = {
    ipamGroupMember: { findMany: async () => [{ group: { permissions: [{ scopeType: 'SUBNET', scopeId: 'subnet-a', permission: 'UPDATE' }] } }] },
    host: { findUnique: async () => ({ id: 'host', ipAddresses: [{ subnet: { id: 'subnet-a', siteId: 'site', vlanId: null, vrfId: null } }, { subnet: { id: 'subnet-b', siteId: 'site', vlanId: null, vrfId: null } }] }) },
  };
  await assert.rejects(() => new IpamAccessService(prisma as never).assertHost(baseUser as never, 'UPDATE', 'host'), ForbiddenException);
});
