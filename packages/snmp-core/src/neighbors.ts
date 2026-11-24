/**
 * SNMP Phase 2 step 11: vendor neighbour protocols as a fallback for LLDP. LLDP-MIB stays the standard source for
 * every vendor (apps/snmp/src/client.ts pollLldp). A vendor may add its own protocol, walked and parsed here, which
 * the poller uses only on ports where LLDP reported no neighbour. Cisco adds CDP (CISCO-CDP-MIB cdpCacheTable);
 * other brands add theirs behind the same NeighborVendor interface (Joao's Phase 2 answer 15).
 * Pure: the SNMP app walks the subtrees the vendor asks for and hands the plain values over (see SnmpWalk).
 */
import { CISCO_ENTERPRISE_OID, SnmpScalar, SnmpWalk, tableRows } from './device-health';

/** Stored in LldpObservation.protocol. LLDP is the default; a fallback row names its own protocol. */
export type NeighborProtocol = 'LLDP' | 'CDP';

export type FallbackNeighbor = {
  protocol: Exclude<NeighborProtocol, 'LLDP'>;
  /** The local port as an IF-MIB ifIndex. */
  ifIndex: number;
  /** The vendor's row index for this neighbour on that port. */
  remoteIndex: number;
  /** The neighbour's own identifier (CDP: cdpCacheDeviceId, usually its hostname, sometimes with a domain or serial). */
  remoteDeviceId: string | null;
  /** The neighbour's port as it names it, for example "TenGigabitEthernet1/0/1". */
  remotePort: string | null;
  platform: string | null;
  softwareVersion: string | null;
  /** An IPv4 or IPv6 address the neighbour advertised, or null. */
  managementAddress: string | null;
  /** Raw capability bits as hex. */
  capabilities: string | null;
  /** Every varbind of the row, keyed by full OID, for the audit trail. */
  rawIdentifiers: Record<string, SnmpScalar>;
};

export interface NeighborVendor {
  id: string;
  matches(sysObjectId: string | null | undefined): boolean;
  /** Subtrees to walk for the fallback protocol; empty when the vendor has none. */
  fallbackWalks: string[];
  parseFallback(walk: SnmpWalk): FallbackNeighbor[];
}

export const NEIGHBOR_OIDS = {
  cdpCacheEntry: '1.3.6.1.4.1.9.9.23.1.2.1.1',
} as const;

const text = (value: SnmpScalar | undefined): string | null => (value === undefined || value === '' ? null : String(value));
const num = (value: SnmpScalar | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * An OCTET STRING address from a walk: hex (unprintable bytes, the usual case) or text (every byte printable).
 * The two forms differ in length (2 characters per byte as hex, 1 as text), so the byte count decides.
 */
function addressBytes(value: SnmpScalar | undefined, length: number): number[] | null {
  if (value === undefined || typeof value === 'number') return null;
  const raw = value.replace(/^0x/i, '');
  if (raw.length === length * 2 && /^[0-9a-f]+$/i.test(raw)) return raw.match(/.{2}/g)!.map((pair) => parseInt(pair, 16));
  if (value.length === length) { const codes = [...value].map((char) => char.charCodeAt(0)); return codes.every((code) => code < 256) ? codes : null; }
  return null;
}

/** CISCO-CDP-MIB cdpCacheAddress, decoded by cdpCacheAddressType (CiscoNetworkProtocol: 1 ip, 20 ipv6). */
export function cdpAddress(type: SnmpScalar | undefined, value: SnmpScalar | undefined): string | null {
  const kind = num(type);
  if (kind === 1) { const bytes = addressBytes(value, 4); return bytes ? bytes.join('.') : null; }
  if (kind === 20) {
    const bytes = addressBytes(value, 16);
    if (!bytes) return null;
    const groups = Array.from({ length: 8 }, (_, index) => ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16));
    return groups.join(':');
  }
  return null;
}

/** cdpCacheTable rows (index cdpCacheIfIndex.cdpCacheDeviceIndex), sorted by port then row. */
export function parseCdpCache(walk: SnmpWalk): FallbackNeighbor[] {
  const entry = NEIGHBOR_OIDS.cdpCacheEntry;
  const neighbours: FallbackNeighbor[] = [];
  for (const [index, row] of tableRows(walk, entry)) {
    const [ifIndex, remoteIndex, ...rest] = index.split('.').map(Number);
    if (rest.length || !Number.isInteger(ifIndex) || !Number.isInteger(remoteIndex) || ifIndex < 1) continue;
    const rawIdentifiers = Object.fromEntries([...row].map(([column, value]) => [`${entry}.${column}.${index}`, value]));
    const neighbour: FallbackNeighbor = {
      protocol: 'CDP', ifIndex, remoteIndex,
      remoteDeviceId: text(row.get(6)), remotePort: text(row.get(7)), platform: text(row.get(8)), softwareVersion: text(row.get(5)),
      managementAddress: cdpAddress(row.get(3), row.get(4)), capabilities: text(row.get(9)), rawIdentifiers,
    };
    // A row with neither a device ID nor a port says nothing usable about the link.
    if (neighbour.remoteDeviceId || neighbour.remotePort) neighbours.push(neighbour);
  }
  return neighbours.sort((a, b) => a.ifIndex - b.ifIndex || a.remoteIndex - b.remoteIndex);
}

const column = (entry: string, ...columns: number[]) => columns.map((item) => `${entry}.${item}`);

export const CISCO_NEIGHBOR_VENDOR: NeighborVendor = {
  id: 'cisco',
  matches: (sysObjectId) => {
    const oid = String(sysObjectId ?? '').replace(/^\./, '');
    return oid === CISCO_ENTERPRISE_OID || oid.startsWith(`${CISCO_ENTERPRISE_OID}.`);
  },
  // cdpCacheAddressType, Address, Version, DeviceId, DevicePort, Platform, Capabilities.
  fallbackWalks: column(NEIGHBOR_OIDS.cdpCacheEntry, 3, 4, 5, 6, 7, 8, 9),
  parseFallback: parseCdpCache,
};

/** Every other vendor: LLDP only. */
export const GENERIC_NEIGHBOR_VENDOR: NeighborVendor = { id: 'generic', matches: () => true, fallbackWalks: [], parseFallback: () => [] };

export const NEIGHBOR_VENDORS: readonly NeighborVendor[] = [CISCO_NEIGHBOR_VENDOR, GENERIC_NEIGHBOR_VENDOR];

export function neighborVendorFor(sysObjectId: string | null | undefined, vendors: readonly NeighborVendor[] = NEIGHBOR_VENDORS): NeighborVendor {
  return vendors.find((vendor) => vendor.matches(sysObjectId)) ?? GENERIC_NEIGHBOR_VENDOR;
}

const portKey = (value: string | null | undefined) => (value ? value.trim().toLowerCase() : '');

/**
 * Keeps only the fallback neighbours on ports where LLDP reported none. An LLDP row names its local port by
 * lldpLocPortId (usually the ifName) and by lldpLocPortNum, which is not always the ifIndex. The name is compared
 * with each port's ifName and ifDescr; the number is used only for an LLDP row whose name is missing or matches
 * no port. With no LLDP rows at all (LLDP off or LLDP-MIB absent), every fallback neighbour is kept.
 */
export function fallbackOnPortsWithoutLldp(
  fallback: readonly FallbackNeighbor[],
  lldp: ReadonlyArray<{ localPortNumber: number; localPortId?: string | null }>,
  interfaces: ReadonlyArray<{ ifIndex: number; name?: string | null; description?: string | null }>,
): FallbackNeighbor[] {
  const namesOf = (item: { name?: string | null; description?: string | null } | undefined) => [item?.name, item?.description].map(portKey).filter(Boolean);
  const knownNames = new Set(interfaces.flatMap((item) => namesOf(item)));
  const lldpNames = new Set(lldp.map((item) => portKey(item.localPortId)).filter((name) => knownNames.has(name)));
  const lldpNumbers = new Set(lldp.filter((item) => !knownNames.has(portKey(item.localPortId))).map((item) => item.localPortNumber));
  const byIndex = new Map(interfaces.map((item) => [item.ifIndex, item]));
  return fallback.filter((neighbour) => !namesOf(byIndex.get(neighbour.ifIndex)).some((name) => lldpNames.has(name)) && !lldpNumbers.has(neighbour.ifIndex));
}
