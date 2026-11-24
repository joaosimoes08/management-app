import { DISCOVERY_SNMP_FIELDS, readEnrichment } from './discovery-snmp';

export type ComparableDiscoveryResult = {
  address: string;
  hostname: string | null;
  icmpReachable: boolean;
  openPorts: unknown;
  /** D-P1a: stored SNMP enrichment (DiscoverySnmpEnrichment) or null. */
  snmp?: unknown;
};

/**
 * D-P1a: SNMP fields that differ between two runs, as `snmp.<field>`. A field counts only when both runs read it, so a
 * run without enrichment (switched off, timeout, auth failure) never shows up as a change.
 */
export function snmpChanges(previous: unknown, current: unknown): string[] {
  const before = readEnrichment(previous); const after = readEnrichment(current);
  if (!before || !after) return [];
  return DISCOVERY_SNMP_FIELDS.filter((field) => {
    const a = before.fields[field]?.value; const b = after.fields[field]?.value;
    return a !== undefined && b !== undefined && a !== b;
  }).map((field) => `snmp.${field}`);
}

export type DiscoveryChange = {
  address: string;
  previous: ComparableDiscoveryResult | null;
  current: ComparableDiscoveryResult | null;
  changes: string[];
};

function ports(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((port): port is number => typeof port === 'number').sort((a, b) => a - b) : [];
}

export function compareDiscoveryResults(previous: ComparableDiscoveryResult[], current: ComparableDiscoveryResult[]) {
  const oldByAddress = new Map(previous.map((result) => [result.address, result]));
  const newByAddress = new Map(current.map((result) => [result.address, result]));
  const newlySeen: DiscoveryChange[] = [];
  const noLongerReachable: DiscoveryChange[] = [];
  const changed: DiscoveryChange[] = [];

  for (const [address, result] of newByAddress) {
    const old = oldByAddress.get(address);
    if (!old) { newlySeen.push({ address, previous: null, current: result, changes: [] }); continue; }
    const differences: string[] = [];
    if (old.hostname !== result.hostname) differences.push('hostname');
    if (old.icmpReachable !== result.icmpReachable) differences.push('icmpReachable');
    if (JSON.stringify(ports(old.openPorts)) !== JSON.stringify(ports(result.openPorts))) differences.push('openPorts');
    differences.push(...snmpChanges(old.snmp, result.snmp));
    if (differences.length) changed.push({ address, previous: old, current: result, changes: differences });
  }
  for (const [address, result] of oldByAddress) {
    if (!newByAddress.has(address)) noLongerReachable.push({ address, previous: result, current: null, changes: [] });
  }
  const byAddress = (a: DiscoveryChange, b: DiscoveryChange) => a.address.localeCompare(b.address, undefined, { numeric: true });
  newlySeen.sort(byAddress); noLongerReachable.sort(byAddress); changed.sort(byAddress);
  return { newlySeen, changed, noLongerReachable };
}
