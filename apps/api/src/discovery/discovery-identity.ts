/**
 * Discovery D-P1c: identity candidates. For a discovered host, suggest which existing Device it most likely is, with a
 * confidence and the reasons. Suggestion-only: nothing here links, merges, creates or changes a Device or a result.
 *
 * Signals (the discovered value is compared with the registered one):
 *   SERIAL_MATCH         SNMP entPhysicalSerialNum (D-P1a) = Device.serialNumber          strongest: serials are unique per chassis
 *   MANAGEMENT_IP_MATCH  the discovered address        = Device.managementIp
 *   SYSNAME_MATCH        SNMP sysName (D-P1a), first DNS label, case-insensitive = Device.hostname or Device.name (first label)
 *   SERIAL_MISMATCH      both serials are known and differ: a contradiction that caps the confidence at LOW
 * MAC addresses are not used yet (ARP/MAC sightings arrive with D-P1e, #187).
 */
import type { DiscoverySnmpEnrichment } from './discovery-snmp';

export type IdentityConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type IdentityReasonCode = 'SERIAL_MATCH' | 'MANAGEMENT_IP_MATCH' | 'SYSNAME_MATCH' | 'SERIAL_MISMATCH';
export type IdentitySignal = 'MANAGEMENT_IP' | 'SERIAL' | 'SYSNAME';
export type IdentityReason = { code: IdentityReasonCode; discovered: string; registered: string };
export type IdentityDevice = { id: string; name: string; hostname: string | null; managementIp: string | null; serialNumber: string | null; siteId: string | null; status: string };
export type IdentityCandidate = { deviceId: string; deviceName: string; siteId: string | null; deviceStatus: string; confidence: IdentityConfidence; score: number; reasons: IdentityReason[] };
export type IdentityHints = { address: string; serial: string | null; sysName: string | null };
export type DiscoveryIdentity = {
  /** Which signals this result had to offer (an unenriched result only has its address). */
  signals: IdentitySignal[];
  /** Best first, at most MAX_IDENTITY_CANDIDATES; only devices the caller may read. Empty when nothing matched. */
  candidates: IdentityCandidate[];
  /** True when the two best candidates have the same confidence: the operator has to choose. */
  ambiguous: boolean;
};

export const MAX_IDENTITY_CANDIDATES = 3;
const WEIGHT: Record<IdentityReasonCode, number> = { SERIAL_MATCH: 60, MANAGEMENT_IP_MATCH: 30, SYSNAME_MATCH: 20, SERIAL_MISMATCH: -50 };
/** Values some agents report instead of a serial; they identify nothing. */
const PLACEHOLDER_SERIALS = new Set(['', 'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', 'NOT SPECIFIED', 'DEFAULT STRING', 'TO BE FILLED BY O.E.M.', '0', '00000000', '123456789']);

export function normaliseSerial(value: string | null | undefined): string | null {
  const serial = value?.trim().toUpperCase() ?? '';
  return serial.length >= 3 && !PLACEHOLDER_SERIALS.has(serial) ? serial : null;
}

/** "Core-SW-01.lab.local" -> "core-sw-01"; null for empty values. */
export function normaliseHostName(value: string | null | undefined): string | null {
  const label = value?.trim().toLowerCase().split('.')[0] ?? '';
  return label.length ? label : null;
}

/** What a discovery result offers for matching. Only SNMP readings that came back (OK or PARTIAL) are used. */
export function identityHints(result: { address: string; snmp: unknown }): IdentityHints {
  const snmp = result.snmp as Partial<DiscoverySnmpEnrichment> | null;
  const fields = snmp && (snmp.status === 'OK' || snmp.status === 'PARTIAL') ? snmp.fields ?? {} : {};
  return { address: result.address, serial: normaliseSerial(fields.entitySerial?.value), sysName: normaliseHostName(fields.sysName?.value) };
}

export function identitySignals(hints: IdentityHints): IdentitySignal[] {
  return [...(['MANAGEMENT_IP'] as const), ...(hints.serial ? (['SERIAL'] as const) : []), ...(hints.sysName ? (['SYSNAME'] as const) : [])];
}

function confidenceOf(codes: Set<IdentityReasonCode>): IdentityConfidence {
  if (codes.has('SERIAL_MISMATCH')) return 'LOW';
  if (codes.has('SERIAL_MATCH')) return 'HIGH';
  if (codes.has('MANAGEMENT_IP_MATCH') && codes.has('SYSNAME_MATCH')) return 'HIGH';
  if (codes.has('MANAGEMENT_IP_MATCH')) return 'MEDIUM';
  return 'LOW';
}

/** Score one device against one result; null when no positive signal matched. */
export function scoreDevice(hints: IdentityHints, device: IdentityDevice): IdentityCandidate | null {
  const reasons: IdentityReason[] = [];
  const serial = normaliseSerial(device.serialNumber);
  if (hints.serial && serial && hints.serial === serial) reasons.push({ code: 'SERIAL_MATCH', discovered: hints.serial, registered: device.serialNumber!.trim() });
  if (device.managementIp && device.managementIp.trim() === hints.address) reasons.push({ code: 'MANAGEMENT_IP_MATCH', discovered: hints.address, registered: device.managementIp.trim() });
  if (hints.sysName) {
    const name = [device.hostname, device.name].find((value) => normaliseHostName(value) === hints.sysName);
    if (name) reasons.push({ code: 'SYSNAME_MATCH', discovered: hints.sysName, registered: name.trim() });
  }
  if (!reasons.length) return null;
  if (hints.serial && serial && hints.serial !== serial) reasons.push({ code: 'SERIAL_MISMATCH', discovered: hints.serial, registered: device.serialNumber!.trim() });
  const codes = new Set(reasons.map((reason) => reason.code));
  return { deviceId: device.id, deviceName: device.name, siteId: device.siteId, deviceStatus: device.status, confidence: confidenceOf(codes), score: reasons.reduce((sum, reason) => sum + WEIGHT[reason.code], 0), reasons };
}

const RANK: Record<IdentityConfidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Rank every device that matched at least one signal: confidence, then score, then name. */
export function matchIdentity(hints: IdentityHints, devices: IdentityDevice[]): DiscoveryIdentity {
  const ranked = devices
    .flatMap((device) => { const candidate = scoreDevice(hints, device); return candidate ? [candidate] : []; })
    .sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || b.score - a.score || a.deviceName.localeCompare(b.deviceName) || a.deviceId.localeCompare(b.deviceId));
  const candidates = ranked.slice(0, MAX_IDENTITY_CANDIDATES);
  return { signals: identitySignals(hints), candidates, ambiguous: candidates.length > 1 && candidates[0].confidence === candidates[1].confidence };
}
