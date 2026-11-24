/**
 * Discovery D-P1e: endpoint tables read from a polled device, read-only (GET/GETBULK walks only).
 *  - ARP: IP-MIB ipNetToPhysicalTable, falling back to the legacy RFC1213 ipNetToMediaTable.
 *  - MAC forwarding: Q-BRIDGE dot1qTpFdbTable (keyed by VLAN through dot1qVlanFdbId), falling back to BRIDGE-MIB
 *    dot1dTpFdbTable (no VLAN in the index). Bridge ports become ifIndex through dot1dBasePortIfIndex.
 * Endpoint rows are sightings (this MAC/IP was seen behind this port, in this VLAN, at this time). They never create
 * or match a Device: a MAC can be virtual, randomised or repeated across VLANs, so it is not a device identity.
 */
import type { Session } from 'net-snmp';
import { subtree } from './client';

export const OIDS = {
  ipNetToPhysical: '1.3.6.1.2.1.4.35.1',
  ipNetToMedia: '1.3.6.1.2.1.4.22.1',
  dot1qTpFdb: '1.3.6.1.2.1.17.7.1.2.2.1',
  dot1qVlanFdbId: '1.3.6.1.2.1.17.7.1.4.2.1.3',
  dot1dTpFdb: '1.3.6.1.2.1.17.4.3.1',
  dot1dBasePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2',
} as const;

/** Per-device bounds per poll; a larger table is cut (newest poll wins) and reported as truncated. */
export const MAX_ARP_ENTRIES = 5_000;
export const MAX_MAC_ENTRIES = 20_000;
/** Endpoint sightings not seen again for this long are pruned by the worker's hourly retention job. */
export const ENDPOINT_RETENTION_DAYS = 30;

export type ArpEntryType = 'OTHER' | 'DYNAMIC' | 'STATIC' | 'LOCAL';
export type MacEntryStatus = 'OTHER' | 'LEARNED' | 'SELF' | 'MGMT';
export type ArpEntry = { ipAddress: string; macAddress: string; ifIndex: number | null; type: ArpEntryType };
/** vlanId null: the device answered BRIDGE-MIB only, whose index has no VLAN. */
export type MacEntry = { vlanId: number | null; macAddress: string; bridgePort: number | null; ifIndex: number | null; status: MacEntryStatus };
export type EndpointTables = { arp: ArpEntry[]; mac: MacEntry[]; arpSource: string | null; macSource: string | null; truncated: boolean };

type Varbind = { oid: string; value?: unknown };
type Walk = (session: Session, oid: string) => Promise<Varbind[]>;

/** "00:a3:d1:ab:00:31" from a 6-byte Buffer, a hex string or "0:a3:..." forms. Anything else (or all zero / broadcast) is null. */
export function normaliseMac(value: unknown): string | null {
  let hex: string;
  if (Buffer.isBuffer(value)) hex = value.toString('hex');
  else if (typeof value === 'string') {
    const parts = value.trim().split(/[:\-. ]/);
    hex = parts.length === 6 ? parts.map((p) => p.padStart(2, '0')).join('') : value.trim().replace(/^0x/i, '').replace(/[:\-. ]/g, '');
  } else return null;
  hex = hex.toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex) || /^0{12}$/.test(hex) || /^f{12}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}

const toInt = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** Column number and index arcs of each varbind under `base` (`base.column.index…`). */
function columns(varbinds: Varbind[], base: string) {
  const prefix = `${base}.`;
  const out: { column: number; index: number[]; value: unknown }[] = [];
  for (const item of varbinds) {
    const oid = String(item.oid).replace(/^\./, '');
    if (!oid.startsWith(prefix)) continue;
    const arcs = oid.slice(prefix.length).split('.').map(Number);
    if (arcs.length < 2 || !arcs.every(Number.isInteger)) continue;
    out.push({ column: arcs[0], index: arcs.slice(1), value: item.value });
  }
  return out;
}

const ARP_TYPES: Record<number, ArpEntryType | null> = { 1: 'OTHER', 2: null, 3: 'DYNAMIC', 4: 'STATIC', 5: 'LOCAL' };
const FDB_STATUS: Record<number, MacEntryStatus | null> = { 1: 'OTHER', 2: null, 3: 'LEARNED', 4: 'SELF', 5: 'MGMT' };

/** ipNetToPhysicalTable: index ifIndex.addressType.length.address…; IPv4 (type 1, length 4) only. Invalid rows are dropped. */
export function parseIpNetToPhysical(varbinds: Varbind[]): ArpEntry[] {
  const rows = new Map<string, { ifIndex: number; ip: string; mac?: string | null; type?: number | null }>();
  for (const { column, index, value } of columns(varbinds, OIDS.ipNetToPhysical)) {
    const [ifIndex, addressType, length, ...address] = index;
    if (addressType !== 1 || length !== 4 || address.length !== 4 || address.some((o) => o < 0 || o > 255)) continue;
    const key = index.join('.');
    const row = rows.get(key) ?? { ifIndex, ip: address.join('.') };
    if (column === 4) row.mac = normaliseMac(value);
    if (column === 6) row.type = toInt(value);
    rows.set(key, row);
  }
  return arpRows(rows.values());
}

/** ipNetToMediaTable (RFC1213): index ifIndex.a.b.c.d. */
export function parseIpNetToMedia(varbinds: Varbind[]): ArpEntry[] {
  const rows = new Map<string, { ifIndex: number; ip: string; mac?: string | null; type?: number | null }>();
  for (const { column, index, value } of columns(varbinds, OIDS.ipNetToMedia)) {
    const [ifIndex, ...address] = index;
    if (address.length !== 4 || address.some((o) => o < 0 || o > 255)) continue;
    const key = index.join('.');
    const row = rows.get(key) ?? { ifIndex, ip: address.join('.') };
    if (column === 2) row.mac = normaliseMac(value);
    if (column === 4) row.type = toInt(value);
    rows.set(key, row);
  }
  return arpRows(rows.values());
}

function arpRows(rows: Iterable<{ ifIndex: number; ip: string; mac?: string | null; type?: number | null }>): ArpEntry[] {
  const out: ArpEntry[] = [];
  for (const row of rows) {
    if (!row.mac) continue;
    const type = row.type == null ? 'OTHER' : ARP_TYPES[row.type] === undefined ? 'OTHER' : ARP_TYPES[row.type];
    if (type === null) continue; // invalid(2): the device marked the entry for removal
    out.push({ ipAddress: row.ip, macAddress: row.mac, ifIndex: row.ifIndex > 0 ? row.ifIndex : null, type });
  }
  return out;
}

/** dot1dBasePortIfIndex: bridge port -> ifIndex. */
export function parseBridgePorts(varbinds: Varbind[]): Map<number, number> {
  const ports = new Map<number, number>();
  for (const item of varbinds) {
    const oid = String(item.oid).replace(/^\./, '');
    if (!oid.startsWith(`${OIDS.dot1dBasePortIfIndex}.`)) continue;
    const port = Number(oid.slice(OIDS.dot1dBasePortIfIndex.length + 1));
    const ifIndex = toInt(item.value);
    if (Number.isInteger(port) && ifIndex !== null && ifIndex > 0) ports.set(port, ifIndex);
  }
  return ports;
}

/** dot1qVlanFdbId (index timeMark.vlanIndex, value fdbId) inverted to fdbId -> VLAN. Shared FDBs (several VLANs) stay unmapped. */
export function parseFdbVlans(varbinds: Varbind[]): Map<number, number> {
  const vlans = new Map<number, number[]>();
  for (const { index, value } of columns(varbinds, OIDS.dot1qVlanFdbId.replace(/\.3$/, '')).filter((item) => item.column === 3)) {
    const vlan = index.at(-1), fdbId = toInt(value);
    if (vlan === undefined || fdbId === null) continue;
    vlans.set(fdbId, [...new Set([...(vlans.get(fdbId) ?? []), vlan])]);
  }
  return new Map([...vlans].flatMap(([fdbId, list]) => (list.length === 1 ? [[fdbId, list[0]] as const] : [])));
}

function validVlan(vlan: number | null | undefined): vlan is number { return Number.isInteger(vlan) && vlan! >= 1 && vlan! <= 4094; }

/**
 * dot1qTpFdbTable: index fdbId.mac(6). The VLAN is the one dot1qVlanFdbId maps to the FDB; without that table, the
 * FDB id is taken as the VLAN (what IVL switches do), and an out-of-range id leaves the VLAN unknown.
 */
export function parseQBridgeFdb(varbinds: Varbind[], fdbVlans: Map<number, number>, bridgePorts: Map<number, number>): MacEntry[] {
  const rows = new Map<string, { fdbId: number; mac: string | null; port?: number | null; status?: number | null }>();
  for (const { column, index, value } of columns(varbinds, OIDS.dot1qTpFdb)) {
    if (index.length !== 7 || index.slice(1).some((o) => o < 0 || o > 255)) continue;
    const key = index.join('.');
    const row = rows.get(key) ?? { fdbId: index[0], mac: normaliseMac(Buffer.from(index.slice(1))) };
    if (column === 2) row.port = toInt(value);
    if (column === 3) row.status = toInt(value);
    rows.set(key, row);
  }
  return macRows([...rows.values()].map((row) => {
    const vlan = fdbVlans.size ? fdbVlans.get(row.fdbId) : row.fdbId;
    return { ...row, vlanId: validVlan(vlan) ? vlan : null };
  }), bridgePorts);
}

/** dot1dTpFdbTable: index mac(6), no VLAN. */
export function parseBridgeFdb(varbinds: Varbind[], bridgePorts: Map<number, number>): MacEntry[] {
  const rows = new Map<string, { vlanId: null; mac: string | null; port?: number | null; status?: number | null }>();
  for (const { column, index, value } of columns(varbinds, OIDS.dot1dTpFdb)) {
    if (index.length !== 6 || index.some((o) => o < 0 || o > 255)) continue;
    const key = index.join('.');
    const row = rows.get(key) ?? { vlanId: null, mac: normaliseMac(Buffer.from(index)) };
    if (column === 2) row.port = toInt(value);
    if (column === 3) row.status = toInt(value);
    rows.set(key, row);
  }
  return macRows([...rows.values()], bridgePorts);
}

function macRows(rows: { vlanId: number | null; mac: string | null; port?: number | null; status?: number | null }[], bridgePorts: Map<number, number>): MacEntry[] {
  const out: MacEntry[] = [];
  for (const row of rows) {
    if (!row.mac) continue;
    const status = row.status == null ? 'OTHER' : FDB_STATUS[row.status] === undefined ? 'OTHER' : FDB_STATUS[row.status];
    if (status === null) continue;
    const bridgePort = row.port != null && row.port > 0 ? row.port : null;
    out.push({ vlanId: row.vlanId, macAddress: row.mac, bridgePort, ifIndex: bridgePort === null ? null : bridgePorts.get(bridgePort) ?? null, status });
  }
  return out;
}

const dedupe = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((row) => [key(row), row])).values()];

/**
 * Walks the endpoint tables. Every walk is best effort (a device without a MIB answers with nothing); a failed walk
 * falls through to the legacy table. Sorted, de-duplicated on the storage keys and capped per device.
 */
export async function pollEndpoints(session: Session, walk: Walk = subtree): Promise<EndpointTables> {
  const safe = (oid: string) => walk(session, oid).catch(() => [] as Varbind[]);
  let arp = parseIpNetToPhysical(await safe(OIDS.ipNetToPhysical));
  let arpSource: string | null = arp.length ? 'IP-MIB' : null;
  if (!arp.length) { arp = parseIpNetToMedia(await safe(OIDS.ipNetToMedia)); arpSource = arp.length ? 'RFC1213-MIB' : null; }

  const bridgePorts = parseBridgePorts(await safe(OIDS.dot1dBasePortIfIndex));
  let mac = parseQBridgeFdb(await safe(OIDS.dot1qTpFdb), parseFdbVlans(await safe(OIDS.dot1qVlanFdbId)), bridgePorts);
  let macSource: string | null = mac.length ? 'Q-BRIDGE-MIB' : null;
  if (!mac.length) { mac = parseBridgeFdb(await safe(OIDS.dot1dTpFdb), bridgePorts); macSource = mac.length ? 'BRIDGE-MIB' : null; }

  arp = dedupe(arp, (row) => `${row.ipAddress}|${row.macAddress}`).sort((a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }) || a.macAddress.localeCompare(b.macAddress));
  mac = dedupe(mac, (row) => `${row.vlanId ?? 0}|${row.macAddress}`).sort((a, b) => (a.vlanId ?? 0) - (b.vlanId ?? 0) || a.macAddress.localeCompare(b.macAddress));
  const truncated = arp.length > MAX_ARP_ENTRIES || mac.length > MAX_MAC_ENTRIES;
  return { arp: arp.slice(0, MAX_ARP_ENTRIES), mac: mac.slice(0, MAX_MAC_ENTRIES), arpSource, macSource, truncated };
}
