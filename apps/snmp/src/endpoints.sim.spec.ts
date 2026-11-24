/**
 * Discovery D-P1e simulator check: runs the real poll job (PollProcessor.run) against the simulated C9300
 * (e2e/snmp-sim-c9300) and an isolated *_test database, and reads back the stored ARP and MAC forwarding sightings.
 * The nolldp variant answers the legacy MIBs only (RFC1213 ARP, BRIDGE-MIB FDB, no VLAN); healthy answers IP-MIB and
 * Q-BRIDGE (VLAN-keyed). Nothing may create or change a Device. Skipped unless SNMP_SIM_C9300=1;
 * e2e/snmp-sim-c9300/cdp-check.sh runs it. Credentials are the simulator's LAB-ONLY test values.
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
  site: 'ed900000-0000-4000-8000-000000000001',
  sim: 'ed900000-0000-4000-8000-000000000002',
  core: 'ed900000-0000-4000-8000-000000000003',
};

describe('D-P1e: ARP and MAC forwarding tables from the simulated C9300', { skip: enabled ? false : 'set SNMP_SIM_C9300=1 with e2e/snmp-sim-c9300 running and an isolated *_test DATABASE_URL' }, () => {
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

  const arp = () => prisma.snmpArpEntry.findMany({ where: { deviceId: ids.sim }, orderBy: [{ ipAddress: 'asc' }, { macAddress: 'asc' }] });
  const mac = () => prisma.snmpMacEntry.findMany({ where: { deviceId: ids.sim }, orderBy: [{ vlanId: 'asc' }, { macAddress: 'asc' }] });

  before(async () => {
    if (!/[_-]test(?:\?|$)/i.test(process.env.DATABASE_URL ?? '')) throw new Error('DATABASE_URL must point at an isolated *_test database.');
    keyringDir = mkdtempSync(join(tmpdir(), 'snmp-ep-sim-'));
    const key = randomBytes(32);
    writeFileSync(join(keyringDir, 'keyring.json'), JSON.stringify({ activeKeyId: 'sim', keys: { sim: key.toString('base64') } }));
    process.env.SNMP_KEYRING_FILE = join(keyringDir, 'keyring.json');
    delete process.env.SNMP_ALLOW_V2C;
    const keyring: SnmpKeyring = { activeKeyId: 'sim', keys: { sim: Uint8Array.from(key) } };
    prisma = new PrismaClient();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1 });
    processor = new PollProcessor(prisma, new DeviceLocks(redis));
    await cleanup();
    await prisma.site.create({ data: { id: ids.site, name: 'Endpoint sim site', code: 'EP-SIM' } });
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

  it(`legacy MIBs (udp ${PORTS.nolldp}): RFC1213 ARP and BRIDGE-MIB forwarding rows, VLAN unknown (0)`, async () => {
    const devicesBefore = await prisma.device.count();
    await poll('nolldp');
    const job = await prisma.snmpJob.findFirstOrThrow({ where: { deviceId: ids.sim }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual((job.result as any).endpoints, { arp: 4, mac: 4, arpSource: 'RFC1213-MIB', macSource: 'BRIDGE-MIB', truncated: false });
    assert.deepEqual((await arp()).map((row) => [row.ipAddress, row.macAddress, row.ifIndex, row.interfaceName, row.entryType, row.source]), [
      ['10.250.70.1', '00:a3:d1:cc:00:01', 49, 'Te1/1/1', 'DYNAMIC', 'RFC1213-MIB'],
      ['10.250.70.2', '00:a3:d1:cc:00:02', 50, 'Te2/1/1', 'STATIC', 'RFC1213-MIB'],
      ['10.250.70.31', '00:a3:d1:ab:00:31', 1, 'Gi1/0/1', 'DYNAMIC', 'RFC1213-MIB'],
      ['10.250.70.50', '00:a3:d1:ee:00:50', 2, 'Gi1/0/2', 'DYNAMIC', 'RFC1213-MIB'],
    ]);
    assert.deepEqual((await mac()).map((row) => [row.vlanId, row.macAddress, row.bridgePort, row.ifIndex, row.status, row.source]), [
      [0, '00:a3:d1:ab:00:31', 1, 1, 'LEARNED', 'BRIDGE-MIB'],
      [0, '00:a3:d1:cc:00:01', 7, 49, 'LEARNED', 'BRIDGE-MIB'],
      [0, '00:a3:d1:cc:00:02', 8, 50, 'LEARNED', 'BRIDGE-MIB'],
      [0, '00:a3:d1:ee:00:50', 2, 2, 'LEARNED', 'BRIDGE-MIB'],
    ]);
    assert.equal(await prisma.device.count(), devicesBefore, 'endpoint sightings never create a Device');
  });

  it(`current MIBs (udp ${PORTS.healthy}): VLAN-keyed rows; re-polling keeps first seen and moves last seen`, async () => {
    await poll('healthy');
    const first = await mac();
    assert.deepEqual(first.filter((row) => row.vlanId > 0).map((row) => [row.vlanId, row.macAddress, row.ifIndex, row.status, row.source]), [
      [70, '00:a3:d1:ab:00:31', 1, 'LEARNED', 'Q-BRIDGE-MIB'],
      [70, '00:a3:d1:cc:00:01', 49, 'LEARNED', 'Q-BRIDGE-MIB'],
      [70, '00:a3:d1:cc:00:02', 50, 'LEARNED', 'Q-BRIDGE-MIB'],
      [70, '00:a3:d1:ee:00:50', 2, 'LEARNED', 'Q-BRIDGE-MIB'],
      [80, '00:a3:d1:c9:30:a1', null, 'SELF', 'Q-BRIDGE-MIB'],
      [80, '00:a3:d1:ee:00:50', 3, 'LEARNED', 'Q-BRIDGE-MIB'],
    ], 'the laptop MAC seen in VLAN 70 and 80 is two sightings');
    assert.equal(first.filter((row) => row.vlanId === 0).length, 4, 'the earlier BRIDGE-MIB rows stay until retention removes them');
    const arpBefore = await arp();
    assert.equal(arpBefore.length, 4, 'same (IP, MAC) pairs: updated in place');
    assert.ok(arpBefore.every((row) => row.source === 'IP-MIB'));

    await new Promise((resolve) => setTimeout(resolve, 20));
    await poll('healthy');
    const after = await arp();
    for (const row of after) {
      const before = arpBefore.find((item) => item.id === row.id)!;
      assert.ok(before, 'no new row for a pair already seen');
      assert.equal(row.firstSeenAt.getTime(), before.firstSeenAt.getTime());
      assert.ok(row.lastSeenAt > before.lastSeenAt);
    }
  });
});
