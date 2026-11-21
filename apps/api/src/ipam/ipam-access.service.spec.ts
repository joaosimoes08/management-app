import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IpamAccessService } from './ipam-access.service';
import { AccessPolicyService } from '../access/access-policy.service';

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
  return new IpamAccessService(prisma as never, new AccessPolicyService());
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

test('the legacy storage role does not activate a group assignment', async () => {
  const access = service([{ siteId: 'site-a', permissions: ['READ'] }]);
  const legacy = { ...user, roles: ['STORAGE_OPERATOR'] };
  assert.deepEqual(await access.whereFor(legacy as never, 'READ', 'site'), { id: { in: [] } });
});

test('returns forbidden when mutating a visible Host spanning an inaccessible subnet', async () => {
  const prisma = {
    accessGroupMember: { findMany: async () => [{ group: { siteAssignments: [{ siteId: 'site-a', permissions: [{ permission: 'READ' }, { permission: 'UPDATE' }] }] } }] },
    host: { findUnique: async () => ({ id: 'host-multi', ipAddresses: [
      { subnet: { id: 'subnet-a', siteId: 'site-a', vlanId: null, vrfId: null } },
      { subnet: { id: 'subnet-b', siteId: 'site-b', vlanId: null, vrfId: null } },
    ] }) },
  };
  const access = new IpamAccessService(prisma as never, new AccessPolicyService());
  await assert.rejects(() => access.assertHost(user as never, 'UPDATE', 'host-multi'), ForbiddenException);
});

function natService(assignments: { siteId: string; permissions: string[] }[]) {
  const prisma = {
    accessGroupMember: { findMany: async () => [{ group: { siteAssignments: assignments.map((item) => ({ siteId: item.siteId, permissions: item.permissions.map((permission) => ({ permission })) })) } }] },
    site: { findUnique: async ({ where }: any) => (where.id === 'missing' ? null : { id: where.id }) },
    vrf: { findUnique: async ({ where }: any) => ({ id: where.id, siteId: where.id === 'vrf-b' ? 'site-b' : 'site-a' }) },
    subnet: { findUnique: async ({ where }: any) => ({ id: where.id, siteId: where.id === 'subnet-b' ? 'site-b' : 'site-a' }) },
    ipAddress: { findUnique: async ({ where }: any) => ({ subnet: { siteId: where.id === 'ip-b' ? 'site-b' : 'site-a' } }) },
    device: { findUnique: async ({ where }: any) => ({ siteId: where.id === 'device-b' ? 'site-b' : 'site-a' }) },
  };
  return new IpamAccessService(prisma as never, new AccessPolicyService());
}

test('NAT writes resolve the Site from the rule Site, VRF, subnets, IPs or device', async () => {
  const access = natService([{ siteId: 'site-a', permissions: ['READ', 'UPDATE'] }, { siteId: 'site-b', permissions: ['READ'] }]);
  assert.deepEqual(await access.natRuleSiteIds({ vrfId: 'vrf-b' }), ['site-b']);
  assert.deepEqual(await access.natRuleSiteIds({ siteId: 'site-a', translatedIpId: 'ip-b', deviceId: 'device-a' }), ['site-a', 'site-b']);
  await access.assertNatRule(user as never, 'UPDATE', { vrfId: 'vrf-a' });
  // VRF-only and Site-only rules used to skip the write check entirely.
  await assert.rejects(() => access.assertNatRule(user as never, 'UPDATE', { vrfId: 'vrf-b' }), ForbiddenException);
  await assert.rejects(() => access.assertNatRule(user as never, 'DELETE', { siteId: 'site-a' }), ForbiddenException);
  await assert.rejects(() => access.assertNatRule(user as never, 'UPDATE', { sourceSubnetId: 'subnet-a', translatedSubnetId: 'subnet-b' }), ForbiddenException);
  await assert.rejects(() => access.assertNatRule(user as never, 'UPDATE', { deviceId: 'device-b' }), ForbiddenException);
});

test('NAT writes on a Site the user cannot see are 404, unscoped rules are refused for non-admins, admins pass', async () => {
  const access = natService([{ siteId: 'site-a', permissions: ['READ', 'CREATE'] }]);
  await assert.rejects(() => access.assertNatRule(user as never, 'CREATE', { vrfId: 'vrf-b' }), NotFoundException);
  await assert.rejects(() => access.assertNatRule(user as never, 'CREATE', { siteId: 'site-a', vrfId: 'vrf-b' }), ForbiddenException);
  await assert.rejects(() => access.assertNatRule(user as never, 'CREATE', {}), (error: any) => error instanceof ForbiddenException && (error.getResponse() as { code?: string }).code === 'IPAM_NAT_SITE_REQUIRED');
  await assert.rejects(() => access.assertNatRule(user as never, 'CREATE', { siteId: 'missing' }), NotFoundException);
  await access.assertNatRule({ ...user, roles: ['ADMIN'] } as never, 'DELETE', {});
});
