import * as snmp from 'net-snmp';
import { detectReboot, DeviceHealthSnapshot, HealthSection, healthVendorFor, SnmpScalar, SnmpWalk } from '@simoes/snmp-core';
import { subtree } from './client';

type Session = ReturnType<typeof snmp.createSession>;

/** SNMP Phase 2 step 8: turns a net-snmp varbind into the plain value the snmp-core parsers expect. */
export function normaliseVarbind(varbind: { type?: number; value?: unknown }): SnmpScalar | null {
  if (!varbind || snmp.isVarbindError(varbind as any)) return null;
  const { type, value } = varbind;
  if (value === null || value === undefined) return null;
  if (type === snmp.ObjectType.Counter64) {
    if (Buffer.isBuffer(value)) return value.length ? BigInt(`0x${value.toString('hex')}`).toString() : '0';
    return typeof value === 'bigint' ? value.toString() : String(value);
  }
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8');
    return /^[\x20-\x7E]*$/.test(text) ? text : value.toString('hex');
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  return String(value).replace(/^\./, '');
}

/**
 * Walks the subtrees the device's vendor asks for, section by section, and parses them. A section that fails
 * (timeout, unsupported MIB) is reported as unavailable; the other sections still count. Throws only if every
 * walk failed, so the caller can keep the last good snapshot.
 */
export async function pollDeviceHealth(session: Session, system: { sysObjectId?: string | null; uptimeTicks?: string | number | null }, walkSubtree = subtree): Promise<DeviceHealthSnapshot> {
  const vendor = healthVendorFor(system.sysObjectId);
  const walk: SnmpWalk = new Map();
  const failedSections: HealthSection[] = [];
  let attempted = 0; let failed = 0;
  // Sections one after another (gentle on the device CPU), the columns of a section in parallel.
  for (const [section, oids] of Object.entries(vendor.walks) as Array<[HealthSection, string[]]>) {
    const results = await Promise.allSettled(oids.map((oid) => walkSubtree(session, oid)));
    attempted += results.length;
    let sectionFailed = false;
    for (const result of results) {
      if (result.status === 'rejected') { failed += 1; sectionFailed = true; continue; }
      for (const varbind of result.value) {
        const value = normaliseVarbind(varbind);
        if (value !== null) walk.set(String(varbind.oid).replace(/^\./, ''), value);
      }
    }
    if (sectionFailed) failedSections.push(section);
  }
  if (attempted > 0 && failed === attempted) throw Object.assign(new Error('SNMP_HEALTH_POLL_FAILED'), { code: 'SNMP_HEALTH_POLL_FAILED' });
  const ticks = system.uptimeTicks === null || system.uptimeTicks === undefined || system.uptimeTicks === '' ? null : Number(system.uptimeTicks);
  return vendor.parse(walk, { uptimeTicks: Number.isFinite(ticks) ? ticks : null, failedSections });
}

export type PreviousHealth = { uptimeTicks: bigint | null; observedAt: Date; rebootDetectedAt: Date | null; rebootCount: number } | null;

const bigintOrNull = (value: string | null | undefined) => (value && /^\d+$/.test(value) ? BigInt(value) : null);

/**
 * The row written to SnmpDeviceHealth for one reading: headline columns plus the full snapshot. Reboot detection
 * compares with the previous reading; a detected reboot is added to that reading's issues and kept in
 * rebootDetectedAt / rebootCount for step 9 alerts.
 */
export function healthRecord(previous: PreviousHealth, snapshot: DeviceHealthSnapshot, jobId: string | null, now: Date = new Date()) {
  const reboot = detectReboot(previous ? { uptimeTicks: previous.uptimeTicks === null ? null : Number(previous.uptimeTicks), observedAt: previous.observedAt } : null, snapshot.uptimeTicks, now);
  const issues = reboot.rebooted ? [...snapshot.issues, { code: 'REBOOT_DETECTED' as const, component: 'sysUpTime', state: reboot.bootedAt ? reboot.bootedAt.toISOString() : 'unknown' }] : snapshot.issues;
  const status = issues.length ? 'DEGRADED' : snapshot.status;
  const data = { ...snapshot, status, issues, reboot: { detected: reboot.rebooted, wrapped: reboot.wrapped } };
  return {
    jobId, vendor: snapshot.vendor, status, observedAt: now,
    uptimeTicks: snapshot.uptimeTicks === null ? null : BigInt(Math.trunc(snapshot.uptimeTicks)),
    bootedAt: reboot.bootedAt,
    rebootDetectedAt: reboot.rebooted ? now : previous?.rebootDetectedAt ?? null,
    rebootCount: (previous?.rebootCount ?? 0) + (reboot.rebooted ? 1 : 0),
    cpu5sPercent: snapshot.cpu?.fiveSecondPercent ?? null,
    cpu1mPercent: snapshot.cpu?.oneMinutePercent ?? null,
    cpu5mPercent: snapshot.cpu?.fiveMinutePercent ?? null,
    memoryUsedPercent: snapshot.memory?.usedPercent ?? null,
    memoryUsedBytes: bigintOrNull(snapshot.memory?.usedBytes),
    memoryTotalBytes: bigintOrNull(snapshot.memory?.totalBytes),
    issueCount: issues.length,
    data,
  };
}

/** SNMP Phase 2 step 9: health history is kept this many days (Joao's answer 13); older samples are pruned. */
export const HEALTH_HISTORY_RETENTION_DAYS = 30;

export function healthHistoryCutoff(now: Date = new Date()) {
  return new Date(now.getTime() - HEALTH_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * SNMP Phase 2 step 9: the history row for one reading (SnmpDeviceHealthSample). Headline numbers plus the cumulative
 * interface error counters, so the API can compute error rates between two samples without the full snapshot.
 */
export function healthSample(deviceId: string, record: ReturnType<typeof healthRecord>) {
  const data = record.data;
  const celsius = data.temperatures.map((item) => item.celsius).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const interfaceErrors = data.interfaces
    .filter((item) => item.inErrors !== null || item.outErrors !== null)
    .map((item) => ({ ifIndex: item.ifIndex, name: item.name, inErrors: item.inErrors, outErrors: item.outErrors }));
  return {
    deviceId,
    observedAt: record.observedAt,
    status: record.status,
    cpu5sPercent: record.cpu5sPercent,
    cpu1mPercent: record.cpu1mPercent,
    cpu5mPercent: record.cpu5mPercent,
    memoryUsedPercent: record.memoryUsedPercent,
    maxTemperatureCelsius: celsius.length ? Math.max(...celsius) : null,
    issueCount: record.issueCount,
    rebooted: Boolean(record.rebootDetectedAt && record.rebootDetectedAt.getTime() === record.observedAt.getTime()),
    interfaceErrors,
  };
}
