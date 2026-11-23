/**
 * SNMP Phase 2 step 8 integration check: polls the simulated Cisco C9300 (e2e/snmp-sim-c9300) over SNMPv2c and
 * SNMPv3 authPriv with the app's own session code and parsers. Needs the simulator running, so it is skipped unless
 * SNMP_SIM_C9300=1 (e2e/snmp-sim-c9300/poll-check.sh does compose up -> this test -> compose down).
 * Credentials are the simulator's LAB-ONLY test values.
 */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { encryptCredential, SnmpKeyring } from '@simoes/snmp-core';
import { createSnmpSession, pollStandard } from './client';
import { healthRecord, pollDeviceHealth } from './device-health';

const enabled = process.env.SNMP_SIM_C9300 === '1';
const host = process.env.SNMP_SIM_HOST ?? '127.0.0.1';
const PORTS = { healthy: Number(process.env.SNMP_SIM_HEALTHY_PORT ?? 16161), degraded: Number(process.env.SNMP_SIM_DEGRADED_PORT ?? 16162) };
const keyring: SnmpKeyring = { activeKeyId: 'sim', keys: { sim: Uint8Array.from(randomBytes(32)) } };
const CREDENTIALS = {
  v2c: { version: 'V2C' as const, username: null, authProtocol: null, privProtocol: null, ...encryptCredential({ community: 'lab-public' }, keyring) },
  v3: { version: 'V3' as const, username: 'labpoll', authProtocol: 'SHA1', privProtocol: 'AES128', ...encryptCredential({ username: 'labpoll', authKey: 'lab-poll-auth-pass', privKey: 'lab-poll-priv-pass' }, keyring) },
};

async function poll(variant: keyof typeof PORTS, auth: keyof typeof CREDENTIALS) {
  const session = createSnmpSession(host, PORTS[variant], 3000, 1, CREDENTIALS[auth], keyring);
  try {
    const standard = await pollStandard(session);
    return { system: standard.system, health: await pollDeviceHealth(session, standard.system) };
  } finally { session.close(); }
}

describe('SNMP Phase 2 step 8: health polling against the simulated C9300', { skip: enabled ? false : 'set SNMP_SIM_C9300=1 with e2e/snmp-sim-c9300 running' }, () => {
  let originalAllowV2c: string | undefined;
  before(() => { originalAllowV2c = process.env.SNMP_ALLOW_V2C; delete process.env.SNMP_ALLOW_V2C; });
  after(() => { if (originalAllowV2c === undefined) delete process.env.SNMP_ALLOW_V2C; else process.env.SNMP_ALLOW_V2C = originalAllowV2c; });

  for (const auth of ['v2c', 'v3'] as const) {
    it(`healthy stack over ${auth} (udp ${PORTS.healthy})`, async () => {
      const { system, health } = await poll('healthy', auth);
      assert.equal(system.sysName, 'sim-c9300-01');
      assert.equal(health.vendor, 'cisco');
      assert.equal(health.status, 'OK');
      assert.deepEqual(health.issues, []);
      assert.deepEqual(health.unavailable, []);
      assert.ok(health.uptimeTicks! > 8_640_000, 'up more than a day');
      assert.equal(health.inventory.filter((item) => item.class === 'chassis').length, 2);
      assert.equal(health.inventory.find((item) => item.index === 1000)!.model, 'C9300-48P');
      assert.equal(health.cpus.length, 2);
      assert.ok(health.cpu!.fiveSecondPercent! < 50 && health.cpu!.oneMinutePercent! < 50 && health.cpu!.fiveMinutePercent! < 50);
      assert.equal(health.memory!.name, 'Processor');
      assert.ok(health.memory!.usedPercent! < 50);
      assert.equal(health.powerSupplies.length, 4);
      assert.equal(health.fans.length, 4);
      assert.equal(health.temperatures.length, 2);
      assert.ok([...health.powerSupplies, ...health.fans, ...health.temperatures].every((item) => item.state === 'normal'));
      assert.equal(health.stack!.ringRedundant, true);
      assert.ok(health.stack!.members.length === 2 && health.stack!.members.every((member) => member.ready));
      assert.equal(health.interfaces.length, 8);
      const uplink2 = health.interfaces.find((item) => item.ifIndex === 50)!;
      assert.equal(uplink2.operUp, true);
      assert.equal(uplink2.highCapacity, true);
      assert.ok(Number(uplink2.inErrors) < 100);
    });

    it(`degraded stack over ${auth} (udp ${PORTS.degraded}), and the reboot is detected after the healthy reading`, async () => {
      const healthy = await poll('healthy', auth);
      const { health } = await poll('degraded', auth);
      assert.equal(health.status, 'DEGRADED');
      assert.ok(health.uptimeTicks! < 60_000, 'rebooted minutes ago');
      assert.deepEqual(health.cpu, { fiveSecondPercent: 97, oneMinutePercent: 94, fiveMinutePercent: 91 });
      assert.ok(health.memory!.usedPercent! > 90);
      assert.equal(health.powerSupplies.find((item) => item.index === 2011)!.state, 'notFunctioning');
      assert.equal(health.fans.find((item) => item.index === 1021)!.state, 'critical');
      assert.equal(health.temperatures.find((item) => item.index === 1010)!.state, 'warning');
      assert.equal(health.stack!.ringRedundant, false);
      assert.equal(health.stack!.members.find((member) => member.index === 2000)!.state, 'verMismatch');
      assert.deepEqual([...new Set(health.issues.map((issue) => issue.code))].sort(), ['FAN_FAULT', 'POWER_SUPPLY_FAULT', 'STACK_MEMBER_NOT_READY', 'STACK_RING_NOT_REDUNDANT', 'TEMPERATURE_STATE']);
      assert.equal(health.interfaces.find((item) => item.ifIndex === 50)!.operUp, false);
      for (const index of [49, 50]) {
        const before = healthy.health.interfaces.find((item) => item.ifIndex === index)!;
        const after = health.interfaces.find((item) => item.ifIndex === index)!;
        assert.ok(Number(after.inErrors) > Number(before.inErrors) * 100, `ifInErrors.${index}`);
      }

      // Same device seen healthy (45 days up) and then degraded (4 minutes up): a sysUpTime drop.
      const first = healthRecord(null, healthy.health, 'job-1', new Date(Date.now() - 300_000));
      const second = healthRecord({ uptimeTicks: first.uptimeTicks, observedAt: first.observedAt, rebootDetectedAt: first.rebootDetectedAt, rebootCount: first.rebootCount }, health, 'job-2');
      assert.equal(first.rebootCount, 0);
      assert.equal(second.rebootCount, 1);
      assert.ok(second.rebootDetectedAt);
      assert.ok(second.data.issues.some((issue) => issue.code === 'REBOOT_DETECTED'));
    });
  }
});
