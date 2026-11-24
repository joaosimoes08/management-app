/**
 * SNMP Phase 2 step 11 simulator check: runs the real poll job (PollProcessor.run) against the simulated C9300
 * (e2e/snmp-sim-c9300) and an isolated *_test database. The LLDP-absent stack must produce CDP observations and a
 * pending link proposal; the healthy stack (LLDP present) must produce LLDP observations only and no second
 * proposal for the same link. Skipped unless SNMP_SIM_C9300=1; e2e/snmp-sim-c9300/cdp-check.sh runs it.
 * Credentials are the simulator's LAB-ONLY test values.
 */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import Redis from 'ioredis';
import { PrismaClient } from '@simoes/database';
import { encryptCredential, SnmpKeyring } from '@simoes/snmp-core';
import { DeviceLocks } from './locks';
import { PollProcessor } from './poll';

const enabled = process.env.SNMP_SIM_C9300 === '1';
const host = process.env.SNMP_SIM_HOST ?? '127.0.0.1';
const PORTS = { healthy: Number(process.env.SNMP_SIM_HEALTHY_PORT ?? 16161), nolldp: Number(process.env.SNMP_SIM_NOLLDP_PORT ?? 16163) };
const ids = {
  site: 'cd900000-0000-4000-8000-000000000001',
  sim: 'cd900000-0000-4000-8000-000000000002',
  core: 'cd900000-0000-4000-8000-000000000003',
};

describe('SNMP Phase 2 step 11: CDP fallback against the simulated C9300', { skip: enabled ? false : 'set SNMP_SIM_C9300=1 with e2e/snmp-sim-c9300 running and an isolated *_test DATABASE_URL' }, () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let processor: PollProcessor;
  let keyringDir: string;
  const saved = { keyring: process.env.SNMP_KEYRING_FILE, allowV2c: process.env.SNMP_ALLOW_V2C };

  async function cleanup() {
    await prisma.topologyProposal.deleteMany({ where: { deviceId: { in: [ids.sim, ids.core] } } });
    await prisma.device.deleteMany({ where: { id: { in: [ids.sim, ids.core] } } });
    await prisma.site.deleteMany({ where: { id: ids.site } });
  }

  async function poll(variant: keyof typeof PORTS) {
    await prisma.snmpDeviceConfig.update({ where: { deviceId: ids.sim }, data: { port: PORTS[variant] } });
    const credential = await prisma.snmpCredential.findUniqueOrThrow({ where: { deviceId_purpose: { deviceId: ids.sim, purpose: 'READ' } } });
    const job = await prisma.snmpJob.create({ data: { deviceId: ids.sim, credentialId: credential.id, type: 'POLL', metadata: { trigger: 'SIM_CHECK' } } });
    const snapshot = await processor.run(job.id) as { id: string };
    assert.equal((await prisma.snmpJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'COMPLETED');
    return snapshot.id;
  }

  const linkProposals = () => prisma.topologyProposal.findMany({ where: { deviceId: ids.sim, action: { in: ['CONNECTION_ADD', 'CONNECTION_UPDATE'] } }, orderBy: { createdAt: 'asc' } });

  before(async () => {
    if (!/[_-]test(?:\?|$)/i.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must point at an isolated *_test database.');
    keyringDir = mkdtempSync(join(tmpdir(), 'snmp-cdp-sim-'));
    const key = randomBytes(32);
    writeFileSync(join(keyringDir, 'keyring.json'), JSON.stringify({ activeKeyId: 'sim', keys: { sim: key.toString('base64') } }));
    process.env.SNMP_KEYRING_FILE = join(keyringDir, 'keyring.json');
    delete process.env.SNMP_ALLOW_V2C;
    const keyring: SnmpKeyring = { activeKeyId: 'sim', keys: { sim: Uint8Array.from(key) } };
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
    processor = new PollProcessor(prisma, new DeviceLocks(redis));
    await cleanup();
    await prisma.site.create({ data: { id: ids.site, name: 'CDP sim site', code: 'CDP-SIM' } });
    await prisma.device.create({ data: { id: ids.sim, name: 'sim-c9300-01', hostname: 'sim-c9300-01', type: 'SWITCH', siteId: ids.site, managementIp: host } });
    await prisma.device.create({ data: { id: ids.core, name: 'core-sw-01', type: 'SWITCH', siteId: ids.site, managementIp: '10.250.70.1' } });
    await prisma.deviceInterface.create({ data: { deviceId: ids.sim, name: 'TenGigabitEthernet1/1/1', portKey: 'Te1/1/1' } });
    await prisma.deviceInterface.create({ data: { deviceId: ids.core, name: 'TenGigabitEthernet1/0/1', portKey: 'Te1/0/1' } });
    await prisma.snmpDeviceConfig.create({ data: { deviceId: ids.sim, enabled: true, port: PORTS.nolldp, timeoutMs: 3000, retries: 1, intervalMinutes: 5 } });
    await prisma.snmpCredential.create({ data: { deviceId: ids.sim, purpose: 'READ', version: 'V2C', ...encryptCredential({ community: 'lab-public' }, keyring) } as never });
  });

  after(async () => {
    await cleanup().catch(() => undefined);
    await prisma?.$disconnect();
    redis?.disconnect();
    rmSync(keyringDir, { recursive: true, force: true });
    if (saved.keyring === undefined) delete process.env.SNMP_KEYRING_FILE; else process.env.SNMP_KEYRING_FILE = saved.keyring;
    if (saved.allowV2c !== undefined) process.env.SNMP_ALLOW_V2C = saved.allowV2c;
  });

  it(`LLDP absent (udp ${PORTS.nolldp}): CDP fills every port and proposes the uplink for review`, async () => {
    const snapshotId = await poll('nolldp');
    const rows = await prisma.lldpObservation.findMany({ where: { snapshotId }, orderBy: { localPortNumber: 'asc' } });
    assert.deepEqual(rows.map((row) => [row.protocol, row.localPortNumber, row.localPortId, row.remoteSystemName, row.remotePortId, row.managementAddress]), [
      ['CDP', 1, 'Gi1/0/1', 'ap-floor1-01', 'GigabitEthernet0', '10.250.70.31'],
      ['CDP', 49, 'Te1/1/1', 'core-sw-01', 'TenGigabitEthernet1/0/1', '10.250.70.1'],
      ['CDP', 50, 'Te2/1/1', 'core-sw-02', 'TenGigabitEthernet1/0/1', '10.250.70.2'],
    ]);
    assert.equal(rows[1].resolvedDeviceId, ids.core, 'resolved by management address within the site');
    assert.equal(rows[1].confidence, 90);
    assert.equal(rows[0].resolvedDeviceId, null);
    const proposals = await linkProposals();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].action, 'CONNECTION_ADD');
    assert.equal(proposals[0].status, 'PENDING', 'manual review only');
    assert.equal((proposals[0].context as any).protocol, 'CDP');
    assert.equal((proposals[0].context as any).observationId, rows[1].id);
    assert.equal(await prisma.deviceConnection.count({ where: { siteId: ids.site } }), 0, 'nothing is applied without review');
  });

  it(`LLDP present (udp ${PORTS.healthy}): LLDP only, and the same link keeps its single pending proposal`, async () => {
    const snapshotId = await poll('healthy');
    const rows = await prisma.lldpObservation.findMany({ where: { snapshotId }, orderBy: { localPortNumber: 'asc' } });
    assert.deepEqual(rows.map((row) => [row.protocol, row.localPortNumber, row.remoteSystemName]), [
      ['LLDP', 1, 'ap-floor1-01'], ['LLDP', 49, 'core-sw-01'], ['LLDP', 50, 'core-sw-02'],
    ], 'CDP is walked but every CDP port already has an LLDP neighbour');
    const proposals = await linkProposals();
    assert.equal(proposals.length, 1, 'deduplicated against the CDP proposal');
    assert.equal(proposals[0].status, 'PENDING');
  });
});
