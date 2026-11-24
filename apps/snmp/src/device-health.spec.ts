import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as snmp from 'net-snmp';
import { CISCO_VENDOR, DeviceHealthSnapshot } from '@simoes/snmp-core';
import { healthRecord, normaliseVarbind, pollDeviceHealth } from './device-health';
import { PollProcessor } from './poll';

/** A net-snmp-like session whose subtree() answers from a fixed varbind list (or fails for chosen prefixes). */
function fakeSession(varbinds: Array<{ oid: string; type: number; value: unknown }>, failing: string[] = []) {
  return {
    subtree(oid: string, _maxRepetitions: number, feed: (items: any[]) => void, done: (error?: Error) => void) {
      if (failing.some((prefix) => oid.startsWith(prefix))) return done(Object.assign(new Error('Request timed out'), { name: 'RequestTimedOutError' }));
      const items = varbinds.filter((item) => item.oid.startsWith(`${oid}.`));
      if (items.length) feed(items);
      done();
    },
  } as any;
}

const T = snmp.ObjectType;
const CISCO_VARBINDS = [
  { oid: '1.3.6.1.2.1.47.1.1.1.1.5.1000', type: T.Integer, value: 3 },
  { oid: '1.3.6.1.2.1.47.1.1.1.1.7.1000', type: T.OctetString, value: Buffer.from('Switch 1') },
  { oid: '1.3.6.1.2.1.2.2.1.8.49', type: T.Integer, value: 1 },
  { oid: '1.3.6.1.2.1.2.2.1.14.49', type: T.Counter, value: 12 },
  { oid: '1.3.6.1.2.1.31.1.1.1.6.49', type: T.Counter64, value: Buffer.from('00d46a9f3be6', 'hex') },
  { oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.2.1', type: T.Integer, value: 1000 },
  { oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.6.1', type: T.Gauge, value: 97 },
  { oid: '1.3.6.1.4.1.9.9.48.1.1.1.2.1', type: T.OctetString, value: Buffer.from('Processor') },
  { oid: '1.3.6.1.4.1.9.9.48.1.1.1.5.1', type: T.Gauge, value: 900 },
  { oid: '1.3.6.1.4.1.9.9.48.1.1.1.6.1', type: T.Gauge, value: 100 },
  { oid: '1.3.6.1.4.1.9.9.13.1.4.1.2.1021', type: T.OctetString, value: Buffer.from('Switch 1 - Fan 2') },
  { oid: '1.3.6.1.4.1.9.9.13.1.4.1.3.1021', type: T.Integer, value: 3 },
  { oid: '1.3.6.1.4.1.9.9.500.1.2.1.1.7.1000', type: T.OctetString, value: Buffer.from('00a3d1c930a1', 'hex') },
  { oid: '1.3.6.1.4.1.9.9.500.1.2.1.1.6.1000', type: T.Integer, value: 4 },
];

describe('SNMP Phase 2 step 8: varbind normalisation', () => {
  it('keeps Counter64 exact, prints text, hex-encodes binary and strips OID dots', () => {
    assert.equal(normaliseVarbind({ type: T.Counter64, value: Buffer.from('ffffffffffffffff', 'hex') }), '18446744073709551615');
    assert.equal(normaliseVarbind({ type: T.OctetString, value: Buffer.from('Processor') }), 'Processor');
    assert.equal(normaliseVarbind({ type: T.OctetString, value: Buffer.from('00a3d1c930a1', 'hex') }), '00a3d1c930a1');
    assert.equal(normaliseVarbind({ type: T.OID, value: '.1.3.6.1.2.1.25.2.1.2' }), '1.3.6.1.2.1.25.2.1.2');
    assert.equal(normaliseVarbind({ type: T.Gauge, value: 51 }), 51);
    assert.equal(normaliseVarbind({ type: T.NoSuchObject, value: null }), null);
    assert.equal(normaliseVarbind({ type: T.EndOfMibView, value: null }), null);
  });
});

describe('SNMP Phase 2 step 8: pollDeviceHealth', () => {
  it('walks the Cisco subtrees for a Cisco sysObjectID and parses them', async () => {
    const health = await pollDeviceHealth(fakeSession(CISCO_VARBINDS), { sysObjectId: '1.3.6.1.4.1.9.1.2494', uptimeTicks: '24000' });
    assert.equal(health.vendor, 'cisco');
    assert.equal(health.uptimeTicks, 24000);
    assert.equal(health.cpus[0].name, 'Switch 1');
    assert.equal(health.cpu!.fiveSecondPercent, 97);
    assert.equal(health.memory!.usedPercent, 90);
    assert.equal(health.interfaces[0].inOctets, String(0xd46a9f3be6));
    assert.equal(health.stack!.members[0].macAddress, '00:a3:d1:c9:30:a1');
    assert.deepEqual(health.issues.map((issue) => issue.code), ['FAN_FAULT']);
  });

  it('marks a timed-out section unavailable and keeps the rest', async () => {
    const health = await pollDeviceHealth(fakeSession(CISCO_VARBINDS, ['1.3.6.1.4.1.9.9.13.']), { sysObjectId: '1.3.6.1.4.1.9.1.2494', uptimeTicks: 1 });
    assert.ok(health.unavailable.includes('environment'));
    assert.equal(health.fans.length, 0);
    assert.equal(health.cpu!.fiveSecondPercent, 97);
  });

  it('uses only standard MIBs for a non-Cisco device', async () => {
    const asked: string[] = [];
    const walker = async (_session: any, oid: string) => { asked.push(oid); return []; };
    const health = await pollDeviceHealth({} as any, { sysObjectId: '1.3.6.1.4.1.2636.1.1.1.2.29', uptimeTicks: null }, walker);
    assert.equal(health.vendor, 'generic');
    assert.ok(asked.length > 0 && asked.every((oid) => !oid.startsWith('1.3.6.1.4.1.')));
    assert.equal(health.status, 'UNKNOWN');
  });

  it('throws when every walk fails, so the last good reading is kept', async () => {
    await assert.rejects(() => pollDeviceHealth(fakeSession([], ['1.']), { sysObjectId: '1.3.6.1.4.1.9.1.2494' }), (error: any) => error.code === 'SNMP_HEALTH_POLL_FAILED');
  });
});

describe('SNMP Phase 2 step 8: stored health record', () => {
  const snapshot = (uptimeTicks: number | null, overrides: Partial<DeviceHealthSnapshot> = {}): DeviceHealthSnapshot => ({ ...CISCO_VENDOR.parse(new Map(), { uptimeTicks }), status: 'OK', ...overrides });
  const now = new Date('2026-11-23T12:05:00Z');

  it('fills the headline columns from the snapshot', () => {
    const record = healthRecord(null, snapshot(388_800_000, { cpu: { fiveSecondPercent: 12, oneMinutePercent: 11, fiveMinutePercent: 9 }, memory: { name: 'Processor', usedBytes: '400', totalBytes: '1000', usedPercent: 40 } }), 'job-1', now);
    assert.equal(record.status, 'OK');
    assert.equal(record.uptimeTicks, 388_800_000n);
    assert.equal(record.cpu5sPercent, 12); assert.equal(record.cpu1mPercent, 11); assert.equal(record.cpu5mPercent, 9);
    assert.equal(record.memoryUsedPercent, 40); assert.equal(record.memoryUsedBytes, 400n); assert.equal(record.memoryTotalBytes, 1000n);
    assert.equal(record.rebootDetectedAt, null); assert.equal(record.rebootCount, 0); assert.equal(record.issueCount, 0);
    assert.equal(record.bootedAt!.getTime(), now.getTime() - 3_888_000_000);
    assert.doesNotThrow(() => JSON.stringify(record.data), 'data must be JSON-safe (no BigInt)');
  });

  it('records a reboot when sysUpTime drops, and keeps it on later readings', () => {
    const previous = { uptimeTicks: 388_800_000n, observedAt: new Date('2026-11-23T12:00:00Z'), rebootDetectedAt: null, rebootCount: 2 };
    const rebooted = healthRecord(previous, snapshot(24_000), 'job-2', now);
    assert.equal(rebooted.status, 'DEGRADED');
    assert.equal(rebooted.rebootDetectedAt!.getTime(), now.getTime());
    assert.equal(rebooted.rebootCount, 3);
    assert.equal(rebooted.data.issues.at(-1)!.code, 'REBOOT_DETECTED');

    const next = healthRecord({ uptimeTicks: 24_000n, observedAt: now, rebootDetectedAt: rebooted.rebootDetectedAt, rebootCount: 3 }, snapshot(54_000), 'job-3', new Date(now.getTime() + 300_000));
    assert.equal(next.status, 'OK');
    assert.equal(next.rebootDetectedAt!.getTime(), now.getTime());
    assert.equal(next.rebootCount, 3);
  });
});

describe('SNMP Phase 2 step 8: health polling inside the standard poll', () => {
  it('upserts the reading for the device', async () => {
    const calls: any[] = [];
    const processor = Object.create(PollProcessor.prototype) as any;
    processor.prisma = { snmpDeviceHealth: { findUnique: async () => null, upsert: async (args: any) => { calls.push(args); } } };
    const status = await processor.storeHealth('device-1', 'job-1', fakeSession(CISCO_VARBINDS), { sysObjectId: '1.3.6.1.4.1.9.1.2494', uptimeTicks: '24000' });
    assert.equal(status, 'DEGRADED');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].where, { deviceId: 'device-1' });
    assert.equal(calls[0].create.deviceId, 'device-1');
    assert.equal(calls[0].update.vendor, 'cisco');
  });

  it('never fails the standard poll when health polling fails', async () => {
    const processor = Object.create(PollProcessor.prototype) as any;
    let upserts = 0;
    processor.prisma = { snmpDeviceHealth: { findUnique: async () => null, upsert: async () => { upserts++; } } };
    const originalWarn = console.warn; console.warn = () => undefined;
    try {
      const status = await processor.storeHealth('device-1', 'job-1', fakeSession([], ['1.']), { sysObjectId: '1.3.6.1.4.1.9.1.2494' });
      assert.equal(status, null);
      assert.equal(upserts, 0);
    } finally { console.warn = originalWarn; }
  });
});
