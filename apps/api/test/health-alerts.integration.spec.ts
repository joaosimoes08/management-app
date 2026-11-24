import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { PrismaClient, type OperationalAlert } from '@simoes/database';
import { collectHealthAlerts, HEALTH_ALERT_SOURCE } from '../src/operations/health-alerts';
import { OperationsService } from '../src/operations/operations.service';

// SNMP Phase 2 step 9: health readings and history rows raise, dedupe and auto-resolve alerts through the existing pipeline.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const siteId = 'c9000000-0000-4000-8000-000000000001';
const deviceId = 'c9000000-0000-4000-8000-000000000002';
const quietId = 'c9000000-0000-4000-8000-000000000003';
const operations = new OperationsService(prisma, {} as never, {} as never, {} as never);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function cleanup() {
  await prisma.operationalAlert.deleteMany({ where: { source: HEALTH_ALERT_SOURCE, entityId: { in: [deviceId, quietId] } } });
  await prisma.device.deleteMany({ where: { id: { in: [deviceId, quietId] } } });
  await prisma.site.deleteMany({ where: { id: siteId } });
}

const degraded = {
  temperatures: [{ index: 1, description: 'Switch 1 - Inlet Temp Sensor', celsius: 58, state: 'warning' }],
  fans: [{ index: 1, description: 'Switch 1 - FAN 1', state: 'normal' }, { index: 2, description: 'Switch 1 - FAN 2', state: 'critical' }],
  powerSupplies: [{ index: 1, description: 'Switch 1 - Power Supply A', state: 'normal' }, { index: 2, description: 'Switch 1 - Power Supply B', state: 'critical' }],
  unavailable: [],
};
const healthy = { ...degraded, temperatures: [{ ...degraded.temperatures[0], celsius: 34, state: 'normal' }], fans: degraded.fans.map((fan) => ({ ...fan, state: 'normal' })), powerSupplies: degraded.powerSupplies.map((psu) => ({ ...psu, state: 'normal' })) };
const errors = (count: number) => [{ ifIndex: 1, name: 'Gi1/0/1', inErrors: String(count), outErrors: '0' }];

before(async () => {
  await cleanup();
  await prisma.site.create({ data: { id: siteId, name: 'P2-9 Health', code: 'P2-9-HEALTH' } });
  await prisma.device.createMany({ data: [{ id: deviceId, name: 'P2-9 core', type: 'SWITCH', siteId }, { id: quietId, name: 'P2-9 quiet', type: 'SWITCH', siteId }] });
  await prisma.snmpDeviceConfig.createMany({ data: [{ deviceId, enabled: true, intervalMinutes: 5 }, { deviceId: quietId, enabled: true, intervalMinutes: 5 }] });
  // quiet: memory 93 % but the site override raises the memory limit to 95 % → no alert.
  await prisma.snmpHealthThreshold.create({ data: { siteId, memoryPercent: 95 } });
  await prisma.snmpHealthThreshold.create({ data: { deviceId, memoryPercent: 90 } });
  const observedAt = minutesAgo(1);
  await prisma.snmpDeviceHealth.createMany({ data: [
    { deviceId, vendor: 'cisco', status: 'DEGRADED', observedAt, rebootDetectedAt: observedAt, cpu5mPercent: 96, memoryUsedPercent: 93, issueCount: 3, data: degraded },
    { deviceId: quietId, vendor: 'cisco', status: 'OK', observedAt, cpu5mPercent: 12, memoryUsedPercent: 93, data: healthy },
  ] });
  await prisma.snmpDeviceHealthSample.createMany({ data: [
    { deviceId, observedAt: minutesAgo(6), status: 'OK', cpu5mPercent: 40, memoryUsedPercent: 60, issueCount: 0, rebooted: false, interfaceErrors: errors(0) },
    { deviceId, observedAt, status: 'DEGRADED', cpu5mPercent: 96, memoryUsedPercent: 93, issueCount: 3, rebooted: false, interfaceErrors: errors(400) },
    { deviceId: quietId, observedAt, status: 'OK', cpu5mPercent: 12, memoryUsedPercent: 93, issueCount: 0, rebooted: false, interfaceErrors: errors(0) },
  ] });
});
after(async () => { await cleanup(); await prisma.$disconnect(); });

const pass = async () => { const plan = await collectHealthAlerts(prisma); await operations.reconcileSource(HEALTH_ALERT_SOURCE, plan.candidates, undefined, false, plan.resolveKeys); return plan; };
const alerts = async (): Promise<Record<string, OperationalAlert>> => Object.fromEntries((await prisma.operationalAlert.findMany({ where: { source: HEALTH_ALERT_SOURCE, entityId: { in: [deviceId, quietId] } } })).map((item) => [item.dedupKey.split(':').pop(), item]));

test('a degraded device raises one alert per condition with Joao\'s severities; overrides apply per site and device', async () => {
  await pass();
  const open = await alerts();
  assert.deepEqual(Object.fromEntries(Object.entries(open).map(([condition, alert]) => [condition, alert.severity])), {
    CPU: 'HIGH', MEMORY: 'HIGH', TEMPERATURE: 'HIGH', FAN: 'CRITICAL', POWER_SUPPLY: 'CRITICAL', REBOOT: 'HIGH', INTERFACE_ERRORS: 'WARNING',
  });
  for (const alert of Object.values(open)) {
    assert.equal(alert.entityId, deviceId, 'the quiet device stays quiet under its site override');
    assert.equal(alert.siteId, siteId);
    assert.equal(alert.status, 'OPEN');
  }
  const firstIds = Object.fromEntries(Object.entries(open).map(([condition, alert]) => [condition, alert.id]));
  await pass();
  const again = await alerts();
  assert.equal(Object.keys(again).length, 7, 'deduplicated per device + condition');
  for (const [condition, alert] of Object.entries(again)) assert.equal(alert.id, firstIds[condition]);
});

test('when the device recovers the alerts auto-resolve; the reboot alert stays for its 24 h window', async () => {
  const observedAt = new Date();
  await prisma.snmpDeviceHealth.update({ where: { deviceId }, data: { status: 'OK', observedAt, cpu5mPercent: 20, memoryUsedPercent: 50, issueCount: 0, data: healthy } });
  await prisma.snmpDeviceHealthSample.create({ data: { deviceId, observedAt, status: 'OK', cpu5mPercent: 20, memoryUsedPercent: 50, issueCount: 0, rebooted: false, interfaceErrors: errors(400) } });
  const plan = await pass();
  const after = await alerts();
  for (const condition of ['CPU', 'MEMORY', 'TEMPERATURE', 'FAN', 'POWER_SUPPLY', 'INTERFACE_ERRORS']) {
    assert.equal(after[condition].status, 'RESOLVED', condition);
    assert.equal(after[condition].resolutionReason, 'Resolvido automaticamente pela reconciliação.');
  }
  // rebootDetectedAt is still within 24 h. Resolving it by hand keeps it closed (covered in the unit tests).
  assert.equal(after.REBOOT.status, 'OPEN');
  assert.equal(plan.devices, 2);
});
