import * as snmp from 'net-snmp';
import { isIP } from 'node:net';
import { decryptCredential, loadKeyring, SNMP_OIDS, SnmpKeyring, SnmpSetTemplate } from '@simoes/snmp-core';

type StoredCredential = {
  version: 'V2C' | 'V3'; username: string | null; authProtocol: string | null; privProtocol: string | null;
  ciphertext: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; authTag: Uint8Array<ArrayBuffer>; wrappedDek: Uint8Array<ArrayBuffer>; wrapIv: Uint8Array<ArrayBuffer>; wrapAuthTag: Uint8Array<ArrayBuffer>; keyId: string;
};
type Session = ReturnType<typeof snmp.createSession>;

export function snmpAuthProtocol(value: string | null) {
  const protocols = snmp.AuthProtocols as unknown as Record<string, number>;
  const normalized = (value ?? 'SHA256').toUpperCase();
  if (!['SHA1', 'SHA256', 'SHA384', 'SHA512'].includes(normalized)) {
    throw Object.assign(new Error('SNMP_AUTH_PROTOCOL_UNSUPPORTED'), { code: 'SNMP_AUTH_PROTOCOL_UNSUPPORTED' });
  }
  const name = normalized === 'SHA1' ? 'sha' : normalized.toLowerCase();
  const protocol = protocols[name];
  if (protocol === undefined) throw Object.assign(new Error('SNMP_AUTH_PROTOCOL_UNSUPPORTED'), { code: 'SNMP_AUTH_PROTOCOL_UNSUPPORTED' });
  return protocol;
}
export function snmpPrivProtocol(value: string | null) {
  const normalized = (value ?? 'AES128').toUpperCase();
  if (!['AES128', 'AES256'].includes(normalized)) {
    throw Object.assign(new Error('SNMP_PRIV_PROTOCOL_UNSUPPORTED'), { code: 'SNMP_PRIV_PROTOCOL_UNSUPPORTED' });
  }
  const protocol = normalized === 'AES256' ? (snmp.PrivProtocols as any).aes256r : snmp.PrivProtocols.aes;
  if (protocol === undefined) throw Object.assign(new Error('SNMP_PRIV_PROTOCOL_UNSUPPORTED'), { code: 'SNMP_PRIV_PROTOCOL_UNSUPPORTED' });
  return protocol;
}

export function decryptStoredCredential(credential: StoredCredential, keyring = loadKeyring()) {
  return decryptCredential(credential, keyring);
}

export function createSnmpSession(target: string, port: number, timeout: number, retries: number, credential: StoredCredential, keyring?: SnmpKeyring): Session {
  if (isIP(target) === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('SNMP_MANAGEMENT_TARGET_INVALID'), { code: 'SNMP_MANAGEMENT_TARGET_INVALID' });
  }
  const secret = decryptStoredCredential(credential, keyring);
  const options = { port, timeout, retries, transport: target.includes(':') ? 'udp6' : 'udp4' } as any;
  if (credential.version === 'V2C') return snmp.createSession(target, secret.community, { ...options, version: snmp.Version2c });
  return snmp.createV3Session(target, {
    name: secret.username ?? credential.username ?? '', level: snmp.SecurityLevel.authPriv,
    authProtocol: snmpAuthProtocol(credential.authProtocol), authKey: secret.authKey,
    privProtocol: snmpPrivProtocol(credential.privProtocol), privKey: secret.privKey,
  }, options) as Session;
}

export function get(session: Session, oids: string[]) {
  return new Promise<any[]>((resolve, reject) => session.get(oids, (error, varbinds) => error ? reject(error) : resolve(varbinds ?? [])));
}

export function subtree(session: Session, oid: string) {
  return new Promise<any[]>((resolve, reject) => {
    const values: any[] = [];
    session.subtree(oid, 20, (varbinds) => values.push(...varbinds), (error) => error ? reject(error) : resolve(values));
  });
}

function printable(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8');
    return /^[\x20-\x7E]*$/.test(text) ? text : value.toString('hex');
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
}

export type PollResult = {
  system: { sysDescr?: string; sysObjectId?: string; uptimeTicks?: string; sysName?: string; sysLocation?: string };
  interfaces: Array<{ ifIndex: number; name?: string; description?: string; alias?: string; interfaceType?: number; macAddress?: string; adminUp?: boolean; operUp?: boolean; speedMbps?: number; counters: Record<string, string> }>;
  raw: Record<string, unknown>;
};

export async function pollStandard(session: Session): Promise<PollResult> {
  const systemOids = [SNMP_OIDS.sysDescr, SNMP_OIDS.sysObjectId, SNMP_OIDS.sysUpTime, SNMP_OIDS.sysName, SNMP_OIDS.sysLocation];
  const [systemValues, ifValues, ifXValues] = await Promise.all([get(session, systemOids), subtree(session, SNMP_OIDS.ifTable), subtree(session, SNMP_OIDS.ifXTable)]);
  const system: PollResult['system'] = {};
  const systemFields = ['sysDescr', 'sysObjectId', 'uptimeTicks', 'sysName', 'sysLocation'] as const;
  systemValues.forEach((item, index) => { const value = printable(item.value); if (value !== null) system[systemFields[index]] = String(value); });
  const rows = new Map<number, PollResult['interfaces'][number]>();
  const row = (index: number) => { if (!rows.has(index)) rows.set(index, { ifIndex: index, counters: {} }); return rows.get(index)!; };
  for (const item of ifValues) {
    const parts = String(item.oid).split('.'); const base = SNMP_OIDS.ifTable.split('.').length; const column = Number(parts[base]); const index = Number(parts[base + 1]);
    if (!Number.isInteger(index)) continue; const target = row(index); const value = printable(item.value);
    if (column === 2) target.description = String(value ?? '');
    else if (column === 3) target.interfaceType = Number(value);
    else if (column === 5) target.speedMbps = Math.round(Number(value) / 1_000_000);
    else if (column === 6) target.macAddress = Buffer.isBuffer(item.value) ? item.value.toString('hex').match(/.{1,2}/g)?.join(':') : String(value ?? '');
    else if (column === 7) target.adminUp = Number(value) === 1;
    else if (column === 8) target.operUp = Number(value) === 1;
    else if (column === 10) target.counters.inOctets = String(value ?? '');
    else if (column === 16) target.counters.outOctets = String(value ?? '');
  }
  for (const item of ifXValues) {
    const parts = String(item.oid).split('.'); const base = SNMP_OIDS.ifXTable.split('.').length; const column = Number(parts[base]); const index = Number(parts[base + 1]);
    if (!Number.isInteger(index)) continue; const target = row(index); const value = printable(item.value);
    if (column === 1) target.name = String(value ?? '');
    else if (column === 6) target.counters.hcInOctets = String(value ?? '');
    else if (column === 10) target.counters.hcOutOctets = String(value ?? '');
    else if (column === 15 && Number(value) > 0) target.speedMbps = Number(value);
    else if (column === 18) target.alias = String(value ?? '');
  }
  return { system, interfaces: [...rows.values()].sort((a, b) => a.ifIndex - b.ifIndex), raw: { systemOids } };
}

export function setValues(session: Session, varbinds: Array<{ oid: string; type: number; value: string | number }>) {
  return new Promise<any[]>((resolve, reject) => session.set(varbinds as any, (error, values) => error ? reject(error) : resolve(values ?? [])));
}

export function setVarbinds(template: SnmpSetTemplate, ifIndex?: number) {
  if (template.operation === 'INTERFACE_ADMIN_STATUS') {
    if (!ifIndex) throw Object.assign(new Error('SNMP_INTERFACE_INDEX_UNAVAILABLE'), { code: 'SNMP_INTERFACE_INDEX_UNAVAILABLE' });
    return [{ oid: `${SNMP_OIDS.ifAdminStatus}.${ifIndex}`, type: snmp.ObjectType.Integer, value: template.adminUp ? 1 : 2 }];
  }
  return [
    ...(template.sysName ? [{ oid: SNMP_OIDS.sysName, type: snmp.ObjectType.OctetString, value: template.sysName }] : []),
    ...(template.sysLocation ? [{ oid: SNMP_OIDS.sysLocation, type: snmp.ObjectType.OctetString, value: template.sysLocation }] : []),
  ];
}
