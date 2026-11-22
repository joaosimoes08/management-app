import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@simoes/database';
import { CAPACITY_ALERT_SOURCE, collectCapacityAlerts, collectCapacityReadings } from '../src/operations/capacity-alerts';
import { OperationsService } from '../src/operations/operations.service';

// Round 2 #15: capacity readings from real rows raise, keep and resolve alerts on the existing alerts page.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const siteId = 'c1500000-0000-4000-8000-000000000001';
const subnetFull = 'c1500000-0000-4000-8000-000000000002';
const subnetHalf = 'c1500000-0000-4000-8000-000000000003';
const subnetP2p = 'c1500000-0000-4000-8000-000000000004';
const rackId = 'c1500000-0000-4000-8000-000000000005';
const operations = new OperationsService(prisma, {} as never, {} as never, {} as never);

async function cleanup() {
  await prisma.operationalAlert.deleteMany({ where: { siteId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
  await prisma.subnet.deleteMany({ where: { id: { in: [subnetFull, subnetHalf, subnetP2p] } } });
}
before(async () => {
  await cleanup();
  await prisma.site.create({ data: { id: siteId, name: 'R2-15 Capacity', code: 'R2-15-CAP', buildings: { create: { name: 'B', rooms: { create: { name: 'Sala', racks: { create: { id: rackId, name: 'R2-15-R01', units: 10 } } } } } } } });
  await prisma.subnet.createMany({ data: [
    { id: subnetFull, cidr: '10.252.0.0/28', version: 4, siteId },
    { id: subnetHalf, cidr: '10.252.1.0/28', version: 4, siteId },
    { id: subnetP2p, cidr: '10.252.2.0/30', version: 4, siteId },
  ] });
  const ip = (subnetId: string, prefix: string, host: number, state: 'OCCUPIED' | 'RESERVED' | 'FREE' = 'OCCUPIED') => ({ subnetId, address: `${prefix}.${host}`, state });
  await prisma.ipAddress.createMany({ data: [
    // /28: 14 usable. 13 allocated = 92.9 % → CRITICAL; FREE rows do not count.
    ...Array.from({ length: 12 }, (_, index) => ip(subnetFull, '10.252.0', index + 1)), ip(subnetFull, '10.252.0', 13, 'RESERVED'), ip(subnetFull, '10.252.0', 14, 'FREE'),
    ...Array.from({ length: 7 }, (_, index) => ip(subnetHalf, '10.252.1', index + 1)),
    ip(subnetP2p, '10.252.2', 1), ip(subnetP2p, '10.252.2', 2),
  ] });
  // 8 of 10 U → WARNING.
  await prisma.device.createMany({ data: [{ name: 'R2-15 server A', type: 'SERVER', siteId, rackId, rackUnitStart: 1, rackUnitSize: 4 }, { name: 'R2-15 server B', type: 'SERVER', siteId, rackId, rackUnitStart: 5, rackUnitSize: 4 }] });
});
after(async () => { await cleanup(); await prisma.$disconnect(); });

const mine = <T extends { siteId?: string | null }>(items: T[]) => items.filter((item) => item.siteId === siteId);

test('readings: exact subnet usage, rack units; point-to-point and half-used subnets are not raised', async () => {
  const readings = mine(await collectCapacityReadings(prisma));
  const byKind = Object.fromEntries(readings.map((item) => [`${item.kind}:${item.id}`, item]));
  assert.deepEqual([byKind[`SUBNET:${subnetFull}`]?.used, byKind[`SUBNET:${subnetFull}`]?.total], [13, 14]);
  assert.equal(byKind[`SUBNET:${subnetHalf}`], undefined);
  assert.equal(byKind[`SUBNET:${subnetP2p}`], undefined, '/30 is full by design');
  assert.deepEqual([byKind[`RACK_SPACE:${rackId}`]?.used, byKind[`RACK_SPACE:${rackId}`]?.total], [8, 10]);
  assert.equal(byKind[`RACK_SPACE:${rackId}`]?.actionHref, `/infraestrutura?siteId=${siteId}&rackId=${rackId}`);
});

test('reconcile: alerts open once, escalate, hold through hysteresis and resolve below it', async () => {
  const pass = async () => { const plan = await collectCapacityAlerts(prisma); await operations.reconcileSource(CAPACITY_ALERT_SOURCE, plan.candidates, undefined, false, plan.resolveKeys); };
  const alerts = async () => Object.fromEntries((await prisma.operationalAlert.findMany({ where: { siteId, source: CAPACITY_ALERT_SOURCE } })).map((item) => [item.dedupKey, item]));

  await pass();
  let open = await alerts();
  assert.deepEqual(Object.keys(open).sort(), [`capacity:rack_space:${rackId}`, `capacity:subnet:${subnetFull}`].sort());
  assert.equal(open[`capacity:subnet:${subnetFull}`].severity, 'CRITICAL');
  assert.equal(open[`capacity:rack_space:${rackId}`].severity, 'WARNING');
  assert.equal(open[`capacity:subnet:${subnetFull}`].actionHref, `/ipam?siteId=${siteId}&subnetId=${subnetFull}`);
  const firstId = open[`capacity:subnet:${subnetFull}`].id;

  await pass();
  open = await alerts();
  assert.equal(Object.keys(open).length, 2, 'no duplicates on a second pass');
  assert.equal(open[`capacity:subnet:${subnetFull}`].id, firstId);

  // 11 of 14 = 78.6 %: below 80 % but inside the 5-point hysteresis → stays open at WARNING.
  await prisma.ipAddress.updateMany({ where: { subnetId: subnetFull, address: { in: ['10.252.0.12', '10.252.0.13'] } }, data: { state: 'FREE' } });
  await pass();
  open = await alerts();
  assert.equal(open[`capacity:subnet:${subnetFull}`].status, 'OPEN');
  assert.equal(open[`capacity:subnet:${subnetFull}`].severity, 'WARNING');

  // 7 of 14 = 50 % → resolved. Moving a server out of the rack (4 of 10 U) resolves the rack alert.
  await prisma.ipAddress.updateMany({ where: { subnetId: subnetFull, address: { in: ['10.252.0.8', '10.252.0.9', '10.252.0.10', '10.252.0.11'] } }, data: { state: 'FREE' } });
  await prisma.device.updateMany({ where: { name: 'R2-15 server B' }, data: { rackId: null, rackUnitStart: null } });
  await pass();
  open = await alerts();
  assert.equal(open[`capacity:subnet:${subnetFull}`].status, 'RESOLVED');
  assert.equal(open[`capacity:rack_space:${rackId}`].status, 'RESOLVED');
});
