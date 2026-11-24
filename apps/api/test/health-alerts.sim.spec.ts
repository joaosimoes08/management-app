/**
 * SNMP Phase 2 step 9 simulator check: polls the simulated Cisco C9300 (e2e/snmp-sim-c9300) with the worker's own
 * session code and parsers, stores the reading and history sample exactly as the worker does, then runs the API's
 * health alert reconcile. Degraded must raise the expected alerts; healthy must resolve them.
 * Skipped unless SNMP_SIM_C9300=1 (e2e/snmp-sim-c9300/alert-check.sh runs it). Needs an isolated *_test database.
 * Credentials are the simulator's LAB-ONLY test values.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Prisma, PrismaClient } from '@simoes/database';
import { encryptCredential, SnmpKeyring } from '@simoes/snmp-core';
import { createSnmpSession, pollStandard } from '../../snmp/src/client';
import { healthRecord, healthSample, pollDeviceHealth } from '../../snmp/src/device-health';
import { collectHealthAlerts, HEALTH_ALERT_SOURCE } from '../src/operations/health-alerts';
import { OperationsService } from '../src/operations/operations.service';

const enabled = process.env.SNMP_SIM_C9300 === '1';
const host = process.env.SNMP_SIM_HOST ?? '127.0.0.1';
const PORTS = { healthy: Number(process.env.SNMP_SIM_HEALTHY_PORT ?? 16161), degraded: Number(process.env.SNMP_SIM_DEGRADED_PORT ?? 16162) };
const keyring: SnmpKeyring = { activeKeyId: 'sim', keys: { sim: Uint8Array.from(randomBytes(32)) } };
const v3 = { version: 'V3' as const, username: 'labpoll', authProtocol: 'SHA1', privProtocol: 'AES128', ...encryptCredential({ username: 'labpoll', authKey: 'lab-poll-auth-pass', privKey: 'lab-poll-priv-pass' }, keyring) };
const siteId = 'c9300000-0000-4000-8000-000000000001';
const deviceId = 'c9300000-0000-4000-8000-000000000002';

describe('SNMP Phase 2 step 9: health alerts from the simulated C9300', { skip: enabled ? false : 'set SNMP_SIM_C9300=1 with e2e/snmp-sim-c9300 running' }, () => {
  let prisma: PrismaClient;
  let operations: OperationsService;
  const cleanup = async () => {
    await prisma.operationalAlert.deleteMany({ where: { source: HEALTH_ALERT_SOURCE, entityId: deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.site.deleteMany({ where: { id: siteId } });
  };
  before(async () => {
    if (!/[_-]test(?:\?|$)/i.test(process.env.DATABASE_URL ?? '')) throw new Error('Needs an isolated DATABASE_URL whose database name ends in _test.');
    prisma = new PrismaClient();
    operations = new OperationsService(prisma, {} as never, {} as never, {} as never);
    await cleanup();
    await prisma.site.create({ data: { id: siteId, name: 'P2-9 Sim', code: 'P2-9-SIM' } });
    await prisma.device.create({ data: { id: deviceId, name: 'sim-c9300-01', type: 'SWITCH', siteId, managementIp: host } });
    await prisma.snmpDeviceConfig.create({ data: { deviceId, enabled: true, intervalMinutes: 5 } });
  });
  after(async () => { if (prisma) { await cleanup(); await prisma.$disconnect(); } });

  // Same steps as SnmpPoller.storeHealth, with an explicit poll time so the 5-minute cadence is reproduced.
  async function pollAndStore(variant: keyof typeof PORTS, observedAt: Date) {
    const session = createSnmpSession(host, PORTS[variant], 3000, 1, v3, keyring);
    try {
      const standard = await pollStandard(session);
      const snapshot = await pollDeviceHealth(session, standard.system);
      const previous = await prisma.snmpDeviceHealth.findUnique({ where: { deviceId }, select: { uptimeTicks: true, observedAt: true, rebootDetectedAt: true, rebootCount: true } });
      const record = healthRecord(previous, snapshot, null, observedAt);
      const data = { ...record, data: record.data as unknown as Prisma.InputJsonValue };
      const sample = healthSample(deviceId, record);
      await prisma.$transaction([
        prisma.snmpDeviceHealth.upsert({ where: { deviceId }, create: { deviceId, ...data }, update: data }),
        prisma.snmpDeviceHealthSample.create({ data: { ...sample, interfaceErrors: sample.interfaceErrors as unknown as Prisma.InputJsonValue } }),
      ]);
      return record;
    } finally { session.close(); }
  }
  async function reconcile(now: Date) {
    const plan = await collectHealthAlerts(prisma, now);
    await operations.reconcileSource(HEALTH_ALERT_SOURCE, plan.candidates, undefined, false, plan.resolveKeys);
    const rows = await prisma.operationalAlert.findMany({ where: { source: HEALTH_ALERT_SOURCE, entityId: deviceId }, orderBy: { dedupKey: 'asc' } });
    return Object.fromEntries(rows.map((row) => [row.dedupKey.split(':').pop()!, { status: row.status, severity: row.severity, id: row.id }]));
  }
  const start = Date.now() - 15 * 60_000;
  const at = (minutes: number) => new Date(start + minutes * 60_000);

  it('healthy raises nothing, degraded raises the expected alerts once, healthy resolves them', async () => {
    await pollAndStore('healthy', at(0));
    assert.deepEqual(await reconcile(at(1)), {}, 'healthy stack: no health alerts');

    const degraded = await pollAndStore('degraded', at(5));
    assert.ok(degraded.rebootDetectedAt, 'sysUpTime dropped from 45 days to 4 minutes');
    const raised = await reconcile(at(6));
    const summary = Object.fromEntries(Object.entries(raised).map(([condition, alert]) => [condition, `${alert.status}/${alert.severity}`]));
    console.log('degraded ->', JSON.stringify(summary));
    assert.deepEqual(summary, {
      CPU: 'OPEN/HIGH', // cpmCPUTotal5minRev 91 % > 90 %: the 5-minute average covers the 5-minute sustain on its own
      FAN: 'OPEN/CRITICAL', // Switch 1 Fan 2 critical
      MEMORY: 'OPEN/HIGH', // Processor pool 94 %
      POWER_SUPPLY: 'OPEN/CRITICAL', // Switch 2 PSU B notFunctioning
      REBOOT: 'OPEN/HIGH',
      TEMPERATURE: 'OPEN/HIGH', // inlet sensor at the device's warning level
    });
    // Interface errors: the reboot reading is not compared across the counter reset, and the simulator's counters are static, so no rate.
    assert.equal(raised.INTERFACE_ERRORS, undefined);

    // Still degraded on the next poll: same alerts, no duplicates.
    await pollAndStore('degraded', at(10));
    const again = await reconcile(at(11));
    assert.deepEqual(Object.keys(again), Object.keys(raised));
    for (const condition of Object.keys(raised)) assert.equal(again[condition].id, raised[condition].id, `${condition} deduplicated`);

    const recovered = await pollAndStore('healthy', at(15));
    assert.equal(recovered.rebootCount, 1, 'uptime going back up is not a second reboot');
    const resolved = await reconcile(at(16));
    const after = Object.fromEntries(Object.entries(resolved).map(([condition, alert]) => [condition, alert.status]));
    console.log('healthy ->', JSON.stringify(after));
    assert.deepEqual(after, { CPU: 'RESOLVED', FAN: 'RESOLVED', MEMORY: 'RESOLVED', POWER_SUPPLY: 'RESOLVED', REBOOT: 'OPEN', TEMPERATURE: 'RESOLVED' });

    // The reboot alert is kept for 24 h after the reboot (documented); once that window has passed it resolves too.
    await prisma.snmpDeviceHealth.update({ where: { deviceId }, data: { rebootDetectedAt: new Date(at(5).getTime() - 24 * 3_600_000) } });
    assert.equal((await reconcile(at(16))).REBOOT.status, 'RESOLVED');
  });
});
