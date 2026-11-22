import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@simoes/database';
import { InventoryQualityService } from '../src/inventory-quality/inventory-quality.service';
import { findFreeButReachable, findMissingIps } from '../src/ipam/ip-drift';
import { IpDriftService } from '../src/ipam/ip-drift.service';
import { OperationsService } from '../src/operations/operations.service';

// Round 2 #6/#14: IP drift rules on the Qualidade page and "Desaparecidos" with "Marcar livre".
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const siteId = 'c1600000-0000-4000-8000-000000000001';
const subnetId = 'c1600000-0000-4000-8000-000000000002';
const otherSubnetId = 'c1600000-0000-4000-8000-000000000003';
const userId = 'c1600000-0000-4000-8000-000000000004';
const hostId = 'c1600000-0000-4000-8000-000000000005';
const ipId = (n: number) => `c1600000-0000-4000-8001-${String(n).padStart(12, '0')}`;
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const admin = { id: userId, username: 'r2-6-admin', roles: ['ADMIN'] } as never;
// Real scoping is covered in the HTTP suite; here every address is visible and updatable.
const access = {
  whereFor: async () => ({}),
  assertIp: async (_user: unknown, _action: string, id: string) => { const ip = await prisma.ipAddress.findUnique({ where: { id } }); if (!ip) { const { NotFoundException } = await import('@nestjs/common'); throw new NotFoundException(); } return ip; },
};

// Same write as AuditService.recordInTransaction, without the BullMQ queue the real service opens.
const auditStub = { recordInTransaction: (tx: PrismaClient, input: { metadata?: unknown }) => tx.auditLog.create({ data: { ...input, metadata: input.metadata as object } as never }) };

async function cleanup() {
  await prisma.inventoryFinding.deleteMany({ where: { siteId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.ipReservation.deleteMany({ where: { createdById: userId } });
  await prisma.subnet.deleteMany({ where: { id: { in: [subnetId, otherSubnetId] } } });
  await prisma.host.deleteMany({ where: { id: hostId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

async function job(id: string, subnet: string, startedDaysAgo: number, addresses: string[], status: 'COMPLETED' | 'FAILED' = 'COMPLETED') {
  await prisma.discoveryJob.create({ data: { id, name: id, subnetId: subnet, methods: ['ICMP'], status, startedAt: daysAgo(startedDaysAgo), completedAt: new Date(daysAgo(startedDaysAgo).getTime() + 60_000), createdAt: daysAgo(startedDaysAgo) } });
  if (addresses.length) await prisma.discoveryResult.createMany({ data: addresses.map((address) => ({ jobId: id, address, icmpReachable: true })) });
}

before(async () => {
  await cleanup();
  await prisma.user.create({ data: { id: userId, externalId: 'r2-6-user', username: 'r2-6-admin', email: 'r2-6@example.test' } });
  await prisma.site.create({ data: { id: siteId, name: 'R2-6 Drift Site', code: 'R2-6-DRIFT' } });
  await prisma.host.create({ data: { id: hostId, name: 'r2-6-host' } });
  await prisma.subnet.create({ data: { id: subnetId, cidr: '10.247.0.0/24', version: 4, siteId } });
  await prisma.subnet.create({ data: { id: otherSubnetId, cidr: '10.247.1.0/24', version: 4, siteId } });
  await prisma.ipAddress.createMany({ data: [
    { id: ipId(10), subnetId, address: '10.247.0.10', state: 'FREE' }, // FREE, answered in the latest scan → drift
    { id: ipId(11), subnetId, address: '10.247.0.11', state: 'FREE' }, // FREE, answered, but freed after the scan → no drift
    { id: ipId(12), subnetId, address: '10.247.0.12', state: 'FREE' }, // FREE, answered only in an older scan → no drift
    { id: ipId(20), subnetId, address: '10.247.0.20', state: 'OCCUPIED' }, // missing
    { id: ipId(21), subnetId, address: '10.247.0.21', state: 'OCCUPIED' }, // answered in an older scan of the window → seen
    { id: ipId(22), subnetId, address: '10.247.0.22', state: 'OCCUPIED', lastSeenAt: daysAgo(2) }, // seen by a recent check → not missing
    { id: ipId(23), subnetId, address: '10.247.0.23', state: 'OCCUPIED', hostId }, // missing, but linked to a host
    { id: ipId(24), subnetId, address: '10.247.0.24', state: 'OCCUPIED' }, // missing, but has an active reservation
    { id: ipId(25), subnetId, address: '10.247.0.25', state: 'OCCUPIED' }, // changed after every scan → not missing yet
    { id: ipId(30), subnetId: otherSubnetId, address: '10.247.1.30', state: 'OCCUPIED' }, // only a FAILED scan → never judged
  ] });
  await prisma.ipReservation.create({ data: { ipAddressId: ipId(24), createdById: userId, reason: 'r2-6 hold', expiresAt: new Date(Date.now() + DAY) } });
  await prisma.$executeRaw`UPDATE "IpAddress" SET "updatedAt" = now() - interval '20 days' WHERE "subnetId" IN (${subnetId}::uuid, ${otherSubnetId}::uuid)`;
  await prisma.$executeRaw`UPDATE "IpAddress" SET "updatedAt" = now() - interval '12 hours' WHERE "id" IN (${ipId(11)}::uuid, ${ipId(25)}::uuid)`;
  await job('c1600000-0000-4000-8002-000000000001', subnetId, 10, ['10.247.0.21', '10.247.0.12']);
  await job('c1600000-0000-4000-8002-000000000002', subnetId, 1, ['10.247.0.10', '10.247.0.11']);
  await job('c1600000-0000-4000-8002-000000000003', subnetId, 45, ['10.247.0.20']); // outside the 30-day window
  await job('c1600000-0000-4000-8002-000000000004', otherSubnetId, 1, [], 'FAILED');
});
after(async () => { await cleanup(); await prisma.$disconnect(); });

test('FREE but reachable: only FREE addresses that answered in the latest scan after their last change', async () => {
  const rows = await findFreeButReachable(prisma, { siteId });
  assert.deepEqual(rows.map((row) => row.address), ['10.247.0.10']);
  assert.equal(rows[0].jobId, 'c1600000-0000-4000-8002-000000000002');
});

test('OCCUPIED not seen: no answer in any completed scan of the last 30 days, no recent lastSeenAt, unchanged since a scan', async () => {
  const rows = await findMissingIps(prisma, { siteId });
  assert.deepEqual(rows.map((row) => row.address), ['10.247.0.20', '10.247.0.23', '10.247.0.24']);
  assert.equal(rows[0].scanCount, 2);
  assert.deepEqual(await findMissingIps(prisma, { subnetIds: [otherSubnetId] }), []);
  assert.deepEqual(await findMissingIps(prisma, { subnetIds: [] }), []);
});

test('Qualidade raises both rules as WARNING findings without alerts, and resolves them when the drift ends', async () => {
  const quality = new InventoryQualityService(prisma, {} as never, {} as never, new OperationsService(prisma, {} as never, {} as never, {} as never), {} as never);
  await quality.reconcileSite(siteId);
  const findings = await prisma.inventoryFinding.findMany({ where: { siteId }, orderBy: { entityId: 'asc' } });
  assert.deepEqual(findings.map((item) => [item.rule, item.entityId, item.severity, item.status]), [
    ['IP_FREE_BUT_REACHABLE', ipId(10), 'WARNING', 'OPEN'],
    ['IP_OCCUPIED_NOT_SEEN', ipId(20), 'WARNING', 'OPEN'],
    ['IP_OCCUPIED_NOT_SEEN', ipId(23), 'WARNING', 'OPEN'],
    ['IP_OCCUPIED_NOT_SEEN', ipId(24), 'WARNING', 'OPEN'],
  ]);
  assert.equal(await prisma.operationalAlert.count({ where: { source: 'INVENTORY_QUALITY', siteId } }), 0);

  // The operator marks .10 as occupied: the FREE-but-reachable finding resolves on the next pass.
  await prisma.ipAddress.update({ where: { id: ipId(10) }, data: { state: 'OCCUPIED' } });
  await quality.reconcileSite(siteId);
  assert.equal((await prisma.inventoryFinding.findUniqueOrThrow({ where: { dedupKey: `ip:${ipId(10)}:free-but-reachable` } })).status, 'RESOLVED');
  // ...and it is not reported as missing, because it changed after the last scan.
  assert.equal(await prisma.inventoryFinding.count({ where: { dedupKey: `ip:${ipId(10)}:occupied-not-seen` } }), 0);
});

test('Marcar livre frees only addresses that are still missing, unlinked and unreserved, with one result each and an audit entry', async () => {
  const service = new IpDriftService(prisma, access as never, auditStub as never);
  const listed = await service.listMissing(admin, { subnetId });
  assert.deepEqual(listed.items.map((item) => item.address), ['10.247.0.20', '10.247.0.23', '10.247.0.24']);

  const outcome = await service.markFree(admin, [ipId(20), ipId(23), ipId(24), ipId(21), 'c1600000-0000-4000-8001-999999999999']);
  assert.deepEqual(outcome.results.map((item) => [item.ipId, item.ok, item.code ?? null]), [
    [ipId(20), true, null],
    [ipId(23), false, 'IP_IN_USE'],
    [ipId(24), false, 'IP_RESERVATION_ACTIVE'],
    [ipId(21), false, 'NOT_MISSING'],
    ['c1600000-0000-4000-8001-999999999999', false, 'NOT_FOUND'],
  ]);
  assert.equal(outcome.succeeded, 1);
  assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: ipId(20) } })).state, 'FREE');
  assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: ipId(23) } })).state, 'OCCUPIED');
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId, action: 'IP_ADDRESS_MARKED_FREE', entityId: ipId(20) } });
  assert.equal((audit.metadata as { reason: string }).reason, 'DISCOVERY_MISSING');

  // Retrying is harmless: the address is no longer missing.
  const retry = await service.markFree(admin, [ipId(20)]);
  assert.deepEqual(retry.results.map((item) => item.code), ['NOT_MISSING']);
  assert.equal(await prisma.auditLog.count({ where: { userId, action: 'IP_ADDRESS_MARKED_FREE' } }), 1);
  assert.deepEqual((await service.listMissing(admin, { subnetId })).items.map((item) => item.address), ['10.247.0.23', '10.247.0.24']);
});
