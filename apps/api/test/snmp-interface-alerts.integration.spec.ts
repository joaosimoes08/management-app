import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@simoes/database';
import { OperationsService } from '../src/operations/operations.service';
import { collectInterfaceAlerts, INTERFACE_ALERT_SOURCE, interfaceDownKey, interfaceUtilisationKey } from '../src/operations/interface-alerts';

// Round 2 #7: interface alerts from real snapshots, through the existing reconcileSource path.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const operations = new OperationsService(prisma, {} as never, {} as never, {} as never);
const siteId = 'c0700000-0000-4000-8000-000000000001';
const ids = { core: 'c0700000-0000-4000-8000-000000000011', edge: 'c0700000-0000-4000-8000-000000000012', stale: 'c0700000-0000-4000-8000-000000000013', off: 'c0700000-0000-4000-8000-000000000014' };
const octetsFor = (mbps: number, seconds: number) => String(Math.round(mbps * 1_000_000 * seconds / 8));

async function cleanup() {
  await prisma.operationalAlert.deleteMany({ where: { source: INTERFACE_ALERT_SOURCE } });
  await prisma.site.deleteMany({ where: { id: siteId } });
}

async function snapshot(deviceId: string, observedAt: Date, interfaces: Array<{ ifIndex: number; deviceInterfaceId?: string; operUp?: boolean; adminUp?: boolean; speedMbps?: number; counters?: Record<string, string> }>) {
  const job = await prisma.snmpJob.create({ data: { deviceId, type: 'POLL', status: 'COMPLETED' } });
  await prisma.snmpSnapshot.create({ data: { deviceId, jobId: job.id, observedAt, interfaces: { create: interfaces.map((item) => ({ name: `Gi0/${item.ifIndex}`, adminUp: true, operUp: true, speedMbps: 1000, ...item })) } } });
}

before(async () => {
  await cleanup();
  await prisma.site.create({ data: { id: siteId, name: 'R2-7 Interface Site', code: 'R2-7-IF' } });
  for (const [key, id] of Object.entries(ids)) await prisma.device.create({ data: { id, name: `r2-7-${key}`, type: 'SWITCH', siteId, status: 'ACTIVE' } });
  const coreUplink = await prisma.deviceInterface.create({ data: { deviceId: ids.core, name: 'Gi0/1' } });
  const edgeUplink = await prisma.deviceInterface.create({ data: { deviceId: ids.edge, name: 'Gi0/1' } });
  const staleUplink = await prisma.deviceInterface.create({ data: { deviceId: ids.stale, name: 'Gi0/1' } });
  await prisma.deviceConnection.create({ data: { siteId, type: 'PHYSICAL', sourceDeviceId: ids.core, sourceInterfaceId: coreUplink.id, targetDeviceId: ids.edge, targetInterfaceId: edgeUplink.id } });
  await prisma.deviceConnection.create({ data: { siteId, type: 'PHYSICAL', sourceDeviceId: ids.stale, sourceInterfaceId: staleUplink.id, targetDeviceId: ids.core } });
  for (const id of Object.values(ids)) await prisma.snmpDeviceConfig.create({ data: { deviceId: id, enabled: id !== ids.off, intervalMinutes: 5 } });

  const now = Date.now();
  const t1 = new Date(now - 6 * 60_000); const t2 = new Date(now - 60_000); const seconds = 300;
  // core: three snapshots, only the latest two count. Uplink (documented) down; Gi0/2 at 95 %; Gi0/3 at 82 %.
  await snapshot(ids.core, new Date(now - 11 * 60_000), [{ ifIndex: 2, counters: { hcInOctets: '0' } }]);
  await snapshot(ids.core, t1, [{ ifIndex: 1, deviceInterfaceId: coreUplink.id }, { ifIndex: 2, counters: { hcInOctets: '0', hcOutOctets: '0' } }, { ifIndex: 3, counters: { hcInOctets: '0', hcOutOctets: '0' } }]);
  await snapshot(ids.core, t2, [{ ifIndex: 1, deviceInterfaceId: coreUplink.id, operUp: false }, { ifIndex: 2, counters: { hcInOctets: octetsFor(950, seconds), hcOutOctets: '0' } }, { ifIndex: 3, counters: { hcInOctets: '0', hcOutOctets: octetsFor(820, seconds) } }]);
  // edge: documented uplink up, low traffic: no alert.
  await snapshot(ids.edge, t2, [{ ifIndex: 1, deviceInterfaceId: edgeUplink.id }]);
  // stale: last poll 40 min ago with the documented uplink down.
  await snapshot(ids.stale, new Date(now - 40 * 60_000), [{ ifIndex: 1, deviceInterfaceId: staleUplink.id, operUp: false }]);
  // off: polling disabled, documented-looking data ignored.
  await snapshot(ids.off, t2, [{ ifIndex: 1, operUp: false }]);
});
after(async () => { await cleanup(); await prisma.$disconnect(); });

test('raises link-down and utilisation alerts from the latest two snapshots and resolves them through the existing path', async () => {
  // Alerts open from before: the stale device's (kept), the disabled device's and a recovered core port (both resolved).
  for (const dedupKey of [interfaceDownKey(ids.stale, 1), interfaceDownKey(ids.off, 1), interfaceDownKey(ids.core, 9)]) {
    await operations.upsert({ dedupKey, source: INTERFACE_ALERT_SOURCE, severity: 'HIGH' as never, siteId, entityType: 'Device', entityId: ids.core, title: 'old', detail: 'old' });
  }
  // Other suites share this database, so only this test's devices are compared.
  const ours = new Set(Object.values(ids));
  const mine = (keys: string[]) => keys.filter((key) => ours.has(key.split(':')[3]));
  const plan = await collectInterfaceAlerts(prisma);
  assert.ok(plan.devices >= 3);
  assert.deepEqual(plan.candidates.filter((item) => ours.has(item.entityId ?? '')).map((item) => [item.dedupKey, item.severity]), [
    [interfaceUtilisationKey(ids.core, 2), 'CRITICAL'],
    [interfaceDownKey(ids.core, 1), 'HIGH'],
    [interfaceUtilisationKey(ids.core, 3), 'WARNING'],
  ]);
  assert.deepEqual(mine(plan.resolveKeys).sort(), [interfaceDownKey(ids.core, 9), interfaceDownKey(ids.off, 1)].sort());

  await operations.reconcileSource(INTERFACE_ALERT_SOURCE, plan.candidates, undefined, false, plan.resolveKeys);
  const alerts = await prisma.operationalAlert.findMany({ where: { source: INTERFACE_ALERT_SOURCE }, select: { dedupKey: true, status: true, severity: true, siteId: true } });
  const byKey = new Map(alerts.map((item) => [item.dedupKey, item]));
  assert.equal(byKey.get(interfaceUtilisationKey(ids.core, 2))?.status, 'OPEN');
  assert.equal(byKey.get(interfaceUtilisationKey(ids.core, 2))?.siteId, siteId);
  assert.equal(byKey.get(interfaceDownKey(ids.core, 1))?.severity, 'HIGH');
  assert.equal(byKey.get(interfaceDownKey(ids.stale, 1))?.status, 'OPEN');
  assert.equal(byKey.get(interfaceDownKey(ids.off, 1))?.status, 'RESOLVED');
  assert.equal(byKey.get(interfaceDownKey(ids.core, 9))?.status, 'RESOLVED');

  // A second pass changes nothing (idempotent): same open set, no duplicates.
  const again = await collectInterfaceAlerts(prisma);
  await operations.reconcileSource(INTERFACE_ALERT_SOURCE, again.candidates, undefined, false, again.resolveKeys);
  assert.equal(await prisma.operationalAlert.count({ where: { source: INTERFACE_ALERT_SOURCE, siteId, status: { not: 'RESOLVED' } } }), 4);
});
