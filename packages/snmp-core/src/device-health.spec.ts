import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CISCO_VENDOR, detectReboot, GENERIC_VENDOR, healthVendorFor, REBOOT_TOLERANCE_MS, SnmpScalar, SnmpWalk, SYS_UPTIME_WRAP } from './device-health';

/** Loads the simulated C9300 data (e2e/snmp-sim-c9300) the way the poller normalises live varbinds. */
function simulatorWalk(variant: 'healthy' | 'degraded'): { walk: SnmpWalk; uptimeTicks: number } {
  const file = join(__dirname, '..', '..', '..', 'e2e', 'snmp-sim-c9300', 'data', `c9300-${variant}.snmprec`);
  const walk: SnmpWalk = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [oid, type, ...rest] = line.split('|');
    const raw = rest.join('|');
    let value: SnmpScalar;
    if (type === '4' || type === '6' || type === '64') value = raw;
    else if (type === '4x') {
      const text = Buffer.from(raw, 'hex').toString('utf8');
      value = /^[\x20-\x7E]*$/.test(text) ? text : raw;
    } else if (type === '70') value = raw;
    else value = Number(raw);
    walk.set(oid, value);
  }
  return { walk, uptimeTicks: Number(walk.get('1.3.6.1.2.1.1.3.0')) };
}

describe('SNMP Phase 2 step 8: vendor selection', () => {
  it('picks Cisco for the Cisco enterprise subtree and the generic fallback otherwise', () => {
    assert.equal(healthVendorFor('1.3.6.1.4.1.9.1.2494').id, 'cisco');
    assert.equal(healthVendorFor('.1.3.6.1.4.1.9.1.2494').id, 'cisco');
    assert.equal(healthVendorFor('1.3.6.1.4.1.99.1').id, 'generic');
    assert.equal(healthVendorFor('1.3.6.1.4.1.8072.3.2.10').id, 'generic');
    assert.equal(healthVendorFor(undefined).id, 'generic');
  });

  it('keeps vendor MIBs out of the generic walk list', () => {
    const generic = Object.values(GENERIC_VENDOR.walks).flat();
    assert.ok(generic.length > 0);
    assert.ok(generic.every((oid) => !oid.startsWith('1.3.6.1.4.1.')), 'generic vendor reads only standard MIBs');
  });
});

describe('SNMP Phase 2 step 8: Cisco parser on the simulated C9300', () => {
  it('parses a healthy 2-member stack', () => {
    const { walk, uptimeTicks } = simulatorWalk('healthy');
    const health = CISCO_VENDOR.parse(walk, { uptimeTicks });
    assert.equal(health.vendor, 'cisco');
    assert.equal(health.status, 'OK');
    assert.deepEqual(health.issues, []);
    assert.deepEqual(health.unavailable, []);
    assert.ok(health.uptimeTicks! > 8_640_000);

    // ENTITY-MIB inventory
    assert.equal(health.inventory.filter((item) => item.class === 'chassis').length, 2);
    assert.equal(health.inventory.filter((item) => item.class === 'powerSupply').length, 4);
    assert.equal(health.inventory.filter((item) => item.class === 'fan').length, 4);
    const member1 = health.inventory.find((item) => item.index === 1000)!;
    assert.equal(member1.model, 'C9300-48P');
    assert.equal(member1.serial, 'FOC2601LAB1');
    assert.equal(member1.softwareRev, '17.9.4a');
    assert.equal(member1.name, 'Switch 1');

    // CPU per member, named from ENTITY-MIB
    assert.equal(health.cpus.length, 2);
    assert.equal(health.cpus[0].name, 'Switch 1');
    assert.ok(health.cpus.every((cpu) => cpu.fiveSecondPercent! < 50 && cpu.oneMinutePercent! < 50 && cpu.fiveMinutePercent! < 50));
    assert.ok(health.cpu!.fiveMinutePercent! < 50);

    // Memory: the Processor pool is the headline figure
    assert.equal(health.memory!.name, 'Processor');
    assert.ok(health.memory!.usedPercent! < 50);
    assert.equal(health.memoryPools.length, 2);

    // Environment and stack
    assert.equal(health.powerSupplies.length, 4);
    assert.equal(health.fans.length, 4);
    assert.equal(health.temperatures.length, 2);
    assert.ok([...health.powerSupplies, ...health.fans, ...health.temperatures].every((item) => item.state === 'normal'));
    assert.equal(health.temperatures[0].celsius! > 0, true);
    assert.equal(health.stack!.ringRedundant, true);
    assert.equal(health.stack!.members.length, 2);
    assert.ok(health.stack!.members.every((member) => member.ready));
    assert.equal(health.stack!.members[0].role, 'master');
    assert.match(health.stack!.members[0].macAddress!, /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);

    // IF-MIB errors and 64-bit octets
    assert.equal(health.interfaces.length, 8);
    const uplink1 = health.interfaces.find((item) => item.ifIndex === 49)!;
    assert.equal(uplink1.operUp, true);
    assert.equal(uplink1.highCapacity, true);
    assert.ok(Number(uplink1.inErrors) < 100);
    assert.match(uplink1.inOctets!, /^\d+$/);
  });

  it('parses the degraded variant: high CPU and memory, failed PSU and fan, warm sensor, stack faults, errors', () => {
    const healthy = CISCO_VENDOR.parse(simulatorWalk('healthy').walk, { uptimeTicks: null });
    const { walk, uptimeTicks } = simulatorWalk('degraded');
    const health = CISCO_VENDOR.parse(walk, { uptimeTicks });
    assert.equal(health.status, 'DEGRADED');
    assert.ok(uptimeTicks < 60_000);

    const member1Cpu = health.cpus.find((cpu) => cpu.physicalIndex === 1000)!;
    assert.deepEqual([member1Cpu.fiveSecondPercent, member1Cpu.oneMinutePercent, member1Cpu.fiveMinutePercent], [97, 94, 91]);
    assert.deepEqual(health.cpu, { fiveSecondPercent: 97, oneMinutePercent: 94, fiveMinutePercent: 91 });
    assert.ok(health.memory!.usedPercent! > 90);

    assert.equal(health.powerSupplies.find((item) => item.index === 2011)!.state, 'notFunctioning');
    assert.equal(health.fans.find((item) => item.index === 1021)!.state, 'critical');
    assert.equal(health.temperatures.find((item) => item.index === 1010)!.state, 'warning');
    assert.equal(health.stack!.ringRedundant, false);
    const member2 = health.stack!.members.find((item) => item.index === 2000)!;
    assert.equal(member2.state, 'verMismatch');
    assert.equal(member2.ready, false);

    const codes = health.issues.map((issue) => `${issue.code}:${issue.component}:${issue.state}`).sort();
    assert.deepEqual(codes, [
      'FAN_FAULT:Switch 1 - Fan 2:critical',
      'POWER_SUPPLY_FAULT:Switch 2 - Power Supply B:notFunctioning',
      'STACK_MEMBER_NOT_READY:Switch 2:verMismatch',
      'STACK_RING_NOT_REDUNDANT:Stack ring:notRedundant',
      'TEMPERATURE_STATE:Switch 1 - Inlet Temp Sensor:warning',
    ]);

    const uplink2 = health.interfaces.find((item) => item.ifIndex === 50)!;
    assert.equal(uplink2.operUp, false);
    for (const index of [49, 50]) {
      const before = healthy.interfaces.find((item) => item.ifIndex === index)!;
      const after = health.interfaces.find((item) => item.ifIndex === index)!;
      assert.ok(Number(after.inErrors) > Number(before.inErrors) * 100, `ifInErrors.${index}`);
      assert.ok(Number(after.outErrors) > Number(before.outErrors), `ifOutErrors.${index}`);
    }
  });

  it('reports sections a device does not answer instead of failing', () => {
    const walk: SnmpWalk = new Map([['1.3.6.1.4.1.9.9.109.1.1.1.1.6.1', 5]]);
    const health = CISCO_VENDOR.parse(walk, { uptimeTicks: 100, failedSections: ['interfaces'] });
    assert.equal(health.status, 'OK');
    assert.deepEqual(health.unavailable, ['entity', 'environment', 'interfaces', 'memory', 'stack']);
    assert.equal(health.stack, null);
    assert.equal(health.memory, null);
    assert.equal(health.cpu!.fiveSecondPercent, 5);
    assert.equal(health.cpu!.fiveMinutePercent, null);
    assert.equal(CISCO_VENDOR.parse(new Map(), { uptimeTicks: null }).status, 'UNKNOWN');
  });

  it('falls back to cpmCPUMemoryHC* (KB) when the device has no memory pools', () => {
    const walk: SnmpWalk = new Map<string, SnmpScalar>([
      ['1.3.6.1.4.1.9.9.109.1.1.1.1.2.1', 1000], ['1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 7],
      ['1.3.6.1.4.1.9.9.109.1.1.1.1.17.1', '3000000'], ['1.3.6.1.4.1.9.9.109.1.1.1.1.19.1', '1000000'],
      ['1.3.6.1.2.1.47.1.1.1.1.7.1000', 'Switch 1'],
    ]);
    const health = CISCO_VENDOR.parse(walk, { uptimeTicks: null });
    assert.equal(health.memory!.name, 'Switch 1');
    assert.equal(health.memory!.usedPercent, 75);
    assert.equal(health.memory!.totalBytes, String(4_000_000 * 1024));
  });

  it('does not flag absent components (notPresent) or a single-member stack ring', () => {
    const walk: SnmpWalk = new Map<string, SnmpScalar>([
      ['1.3.6.1.4.1.9.9.13.1.5.1.2.11', 'PSU B'], ['1.3.6.1.4.1.9.9.13.1.5.1.3.11', 5],
      ['1.3.6.1.4.1.9.9.500.1.1.3.0', 2],
      ['1.3.6.1.4.1.9.9.500.1.2.1.1.1.1000', 1], ['1.3.6.1.4.1.9.9.500.1.2.1.1.6.1000', 4],
    ]);
    const health = CISCO_VENDOR.parse(walk, { uptimeTicks: 1 });
    assert.equal(health.powerSupplies[0].state, 'notPresent');
    assert.deepEqual(health.issues, []);
  });
});

describe('SNMP Phase 2 step 8: generic standard-MIB parser', () => {
  it('reads HOST-RESOURCES CPU and RAM, ENTITY-MIB and IF-MIB 32-bit counters', () => {
    const walk: SnmpWalk = new Map<string, SnmpScalar>([
      ['1.3.6.1.2.1.25.3.3.1.2.196608', 12], ['1.3.6.1.2.1.25.3.3.1.2.196609', 40],
      ['1.3.6.1.2.1.25.2.3.1.2.1', '1.3.6.1.2.1.25.2.1.2'], ['1.3.6.1.2.1.25.2.3.1.3.1', 'Physical memory'],
      ['1.3.6.1.2.1.25.2.3.1.4.1', 1024], ['1.3.6.1.2.1.25.2.3.1.5.1', 1000], ['1.3.6.1.2.1.25.2.3.1.6.1', 250],
      ['1.3.6.1.2.1.25.2.3.1.2.31', '1.3.6.1.2.1.25.2.1.4'], ['1.3.6.1.2.1.25.2.3.1.3.31', '/'],
      ['1.3.6.1.2.1.47.1.1.1.1.5.1', 3], ['1.3.6.1.2.1.47.1.1.1.1.13.1', 'GEN-1'],
      ['1.3.6.1.2.1.2.2.1.8.1', 1], ['1.3.6.1.2.1.2.2.1.14.1', 3], ['1.3.6.1.2.1.2.2.1.10.1', 4096],
    ]);
    const health = GENERIC_VENDOR.parse(walk, { uptimeTicks: 500 });
    assert.equal(health.vendor, 'generic');
    assert.equal(health.status, 'OK');
    assert.equal(health.cpu!.oneMinutePercent, 40);
    assert.equal(health.memoryPools.length, 1, 'only hrStorageRam rows count as memory');
    assert.equal(health.memory!.usedPercent, 25);
    assert.equal(health.memory!.totalBytes, String(1000 * 1024));
    assert.equal(health.inventory[0].model, 'GEN-1');
    assert.deepEqual({ inErrors: health.interfaces[0].inErrors, inOctets: health.interfaces[0].inOctets, highCapacity: health.interfaces[0].highCapacity }, { inErrors: '3', inOctets: '4096', highCapacity: false });
    assert.deepEqual(health.unavailable, []);
  });
});

describe('SNMP Phase 2 step 8: reboot detection from sysUpTime', () => {
  const t0 = new Date('2026-11-23T12:00:00Z');
  const later = (ms: number) => new Date(t0.getTime() + ms);

  it('does not flag the first poll but still estimates the boot time', () => {
    const result = detectReboot(null, 24_000, t0);
    assert.equal(result.rebooted, false);
    assert.equal(result.bootedAt!.toISOString(), new Date(t0.getTime() - 240_000).toISOString());
  });

  it('does not flag a normally advancing uptime', () => {
    assert.equal(detectReboot({ uptimeTicks: 1_000_000, observedAt: t0 }, 1_030_000, later(300_000)).rebooted, false);
  });

  it('flags a sysUpTime drop (healthy 45 days -> degraded 4 minutes)', () => {
    const healthy = simulatorWalk('healthy').uptimeTicks; const degraded = simulatorWalk('degraded').uptimeTicks;
    const result = detectReboot({ uptimeTicks: healthy, observedAt: t0 }, degraded, later(300_000));
    assert.equal(result.rebooted, true);
    assert.equal(result.bootedAt!.getTime(), later(300_000).getTime() - degraded * 10);
  });

  it('flags a reboot after a long gap even when the new uptime is larger than the old one', () => {
    // Polled at 1 h uptime; 1 day later the device reports 2 h uptime: it booted 22 h after the previous poll.
    assert.equal(detectReboot({ uptimeTicks: 360_000, observedAt: t0 }, 720_000, later(86_400_000)).rebooted, true);
  });

  it('does not treat the 32-bit wrap (~497 days) as a reboot', () => {
    const before = SYS_UPTIME_WRAP - 10_000; // 100 s before wrapping
    const result = detectReboot({ uptimeTicks: before, observedAt: t0 }, 20_000, later(300_000));
    assert.equal(result.rebooted, false);
    assert.equal(result.wrapped, true);
  });

  it('tolerates poll jitter within the tolerance window', () => {
    // Uptime advanced slightly less than wall clock (slow poll): not a reboot.
    assert.equal(detectReboot({ uptimeTicks: 1_000_000, observedAt: t0 }, 1_000_000 + 30_000 - (REBOOT_TOLERANCE_MS / 10 - 100), later(300_000)).rebooted, false);
    assert.equal(detectReboot({ uptimeTicks: 1_000_000, observedAt: t0 }, null, later(300_000)).rebooted, false);
  });
});
