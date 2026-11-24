import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AccessPolicyService } from '../src/access/access-policy.service';
import { InfrastructureAccessService } from '../src/infrastructure/infrastructure-access.service';

// readableDeviceIds is the batch form of assertDevice(user, 'READ', id), used by the SNMP endpoint and discovery lists.
// It must return exactly the ids for which the per-device check passes, for every role and every scope layout.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const id = (block: number, n: number) => `c2400000-0000-4000-${String(8000 + block)}-${String(n).padStart(12, '0')}`;
const site = (n: number) => id(1, n), building = (n: number) => id(2, n), room = (n: number) => id(3, n), rack = (n: number) => id(4, n);
const device = (n: number) => id(5, n), group = (n: number) => id(6, n), user = (n: number) => id(7, n);
const service = new InfrastructureAccessService(prisma, {} as never, new AccessPolicyService());

// Layout:
//  site 1 (SITE rule: group 1)
//    building 1 (no rule)    → room 1 (ROOM rule: group 2), room 2 (no rule → site rule)
//    building 2 (BUILDING rule: group 3) → room 3 (no rule → building rule)
//  site 2 (no rule)          → building 3 → room 4 (ROOM rule: group 2), building 4 → room 5 (no rule)
//  site 3 (no rule, no buildings)
// Groups 1-3 are assigned to sites 1 and 2; group 4 holds a SITE 1 rule but is assigned to no site.
const devices = {
  room1: device(1), room2: device(2), room3: device(3), room4: device(4), room5: device(5),
  site1Unracked: device(6), site2Unracked: device(7), site3Unracked: device(8), nowhere: device(9),
};
const missing = device(99);
const users = [
  { id: user(1), username: 'r24-admin', roles: ['ADMIN'], groups: [] as number[] },
  { id: user(2), username: 'r24-readonly-g1', roles: ['READ_ONLY'], groups: [1] },
  { id: user(3), username: 'r24-readonly-g2', roles: ['READ_ONLY'], groups: [2] },
  { id: user(4), username: 'r24-netop-g3', roles: ['NETWORK_OPERATOR'], groups: [3] },
  { id: user(5), username: 'r24-sysop-g1g2g3', roles: ['SYSTEMS_OPERATOR'], groups: [1, 2, 3] },
  { id: user(6), username: 'r24-auditor-nogroup', roles: ['AUDITOR'], groups: [] },
  { id: user(7), username: 'r24-readonly-unassigned', roles: ['READ_ONLY'], groups: [4] },
  { id: user(8), username: 'r24-norole-g1', roles: [], groups: [1] },
];

async function cleanup() {
  await prisma.device.deleteMany({ where: { id: { in: Object.values(devices) } } });
  await prisma.infrastructurePermission.deleteMany({ where: { groupId: { in: [1, 2, 3, 4].map(group) } } });
  await prisma.accessGroup.deleteMany({ where: { id: { in: [1, 2, 3, 4].map(group) } } });
  await prisma.site.deleteMany({ where: { id: { in: [1, 2, 3].map(site) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((item) => item.id) } } });
}

before(async () => {
  await cleanup();
  await prisma.site.createMany({ data: [1, 2, 3].map((n) => ({ id: site(n), name: `R24 Scope Site ${n}`, code: `R24-SCOPE-${n}` })) });
  await prisma.building.createMany({ data: [[1, 1], [2, 1], [3, 2], [4, 2]].map(([b, s]) => ({ id: building(b), name: `R24 B${b}`, siteId: site(s) })) });
  await prisma.room.createMany({ data: [[1, 1], [2, 1], [3, 2], [4, 3], [5, 4]].map(([r, b]) => ({ id: room(r), name: `R24 Room ${r}`, buildingId: building(b) })) });
  await prisma.rack.createMany({ data: [1, 2, 3, 4, 5].map((n) => ({ id: rack(n), name: `R24 Rack ${n}`, roomId: room(n) })) });
  await prisma.device.createMany({ data: [
    ...[1, 2, 3, 4, 5].map((n) => ({ id: device(n), name: `r24-racked-${n}`, type: n % 2 ? 'SWITCH' : 'SERVER', rackId: rack(n), siteId: site(n <= 3 ? 1 : 2) })),
    { id: devices.site1Unracked, name: 'r24-site1', type: 'SERVER', siteId: site(1) },
    { id: devices.site2Unracked, name: 'r24-site2', type: 'SWITCH', siteId: site(2) },
    { id: devices.site3Unracked, name: 'r24-site3', type: 'SERVER', siteId: site(3) },
    { id: devices.nowhere, name: 'r24-nowhere', type: 'SERVER' },
  ] });
  await prisma.accessGroup.createMany({ data: [1, 2, 3, 4].map((n) => ({ id: group(n), name: `R24 Scope Group ${n}` })) });
  await prisma.accessGroupSite.createMany({ data: [1, 2, 3].flatMap((g) => [1, 2].map((s) => ({ groupId: group(g), siteId: site(s) }))) });
  await prisma.infrastructurePermission.createMany({ data: [
    { groupId: group(1), scopeType: 'SITE', scopeId: site(1), permission: 'READ' },
    { groupId: group(2), scopeType: 'ROOM', scopeId: room(1), permission: 'READ' },
    { groupId: group(3), scopeType: 'BUILDING', scopeId: building(2), permission: 'UPDATE' },
    { groupId: group(2), scopeType: 'ROOM', scopeId: room(4), permission: 'READ' },
    { groupId: group(4), scopeType: 'SITE', scopeId: site(1), permission: 'READ' },
  ] });
  for (const item of users) await prisma.user.create({ data: { id: item.id, externalId: item.username, username: item.username, email: `${item.username}@example.test` } });
  await prisma.accessGroupMember.createMany({ data: users.flatMap((item) => item.groups.map((g) => ({ groupId: group(g), userId: item.id }))) });
});
after(async () => { await cleanup(); await prisma.$disconnect(); });

async function perDevice(caller: never, ids: string[]) {
  const readable = new Set<string>();
  for (const deviceId of ids) {
    try { await service.assertDevice(caller, 'READ', deviceId); readable.add(deviceId); } catch (error) { if (!(error instanceof HttpException)) throw error; }
  }
  return readable;
}

const allIds = [...Object.values(devices), missing];

for (const item of users) {
  test(`readableDeviceIds equals per-device assertDevice READ for ${item.username}`, async () => {
    const caller = { id: item.id, username: item.username, roles: item.roles } as never;
    const expected = await perDevice(caller, allIds);
    const actual = await service.readableDeviceIds(caller, [...allIds, devices.room1]);
    assert.deepEqual([...actual].sort(), [...expected].sort());
  });
}

test('the matrix exercises both outcomes on every placement', async () => {
  const visible = new Map<string, number>();
  for (const item of users) {
    const caller = { id: item.id, username: item.username, roles: item.roles } as never;
    for (const deviceId of await service.readableDeviceIds(caller, allIds)) visible.set(deviceId, (visible.get(deviceId) ?? 0) + 1);
  }
  for (const [name, deviceId] of Object.entries(devices)) {
    const count = visible.get(deviceId) ?? 0;
    assert.ok(count > 0 && count < users.length, `${name} should be visible to some callers but not all (seen by ${count})`);
  }
  assert.equal(visible.get(missing), undefined);
});

test('spot checks of the expected scope outcomes', async () => {
  const as = (n: number) => ({ id: users[n - 1].id, username: users[n - 1].username, roles: users[n - 1].roles }) as never;
  const sorted = async (n: number) => [...await service.readableDeviceIds(as(n), allIds)].sort();
  // Group 1 reads via the site rule: room 2 and site 1 unracked; room 1 and building 2 have their own rules.
  assert.deepEqual(await sorted(2), [devices.room2, devices.site1Unracked].sort());
  // Group 2: room 1 and room 4; unracked devices on sites 1 and 2 show through a visible building.
  assert.deepEqual(await sorted(3), [devices.room1, devices.room4, devices.site1Unracked, devices.site2Unracked].sort());
  // An AUDITOR without a group, a group assigned to no site, and no role at all see nothing.
  assert.deepEqual(await sorted(6), []);
  assert.deepEqual(await sorted(7), []);
  assert.deepEqual(await sorted(8), []);
  assert.equal((await service.readableDeviceIds(as(1), [])).size, 0);
});
