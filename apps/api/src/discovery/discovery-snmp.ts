import * as snmp from 'net-snmp';
import { isIP } from 'node:net';
import type { PrismaClient } from '@simoes/database';
import { decryptCredential, loadKeyring, SNMP_OIDS, snmpV2cAllowed, type SnmpEnvelope, type SnmpKeyring } from '@simoes/snmp-core';
import type { ProbeRunner } from './discovery-limiter';

/**
 * D-P1a: optional SNMP enrichment during discovery, switched on per subnet.
 *
 * - A subnet points at most at one READ credential (`Subnet.discoverySnmpCredentialId`; null = off, the default).
 * - A scan fixes that credential when it first starts (`DiscoveryJob.snmpCredentialId`) and tries it only on hosts that
 *   answered ping or TCP in that scan. It never tries another credential, another purpose or another address.
 * - Each target costs one slot of the subnet's shared `ProbeLimiter` (rate, subnet socket cap, process ceiling): one
 *   UDP socket for a GET of the system group, a bounded walk of entPhysicalClass and a GET of the chassis model/serial.
 * - Auth failures and timeouts are stored per target (`DiscoveryResult.snmp`) and never fail the scan.
 * - Every collected value carries its provenance: source SNMP, the credential id, the OID and when it was observed.
 */

export const ENTITY_OIDS = {
  physicalClass: '1.3.6.1.2.1.47.1.1.1.1.5',
  serialNum: '1.3.6.1.2.1.47.1.1.1.1.11',
  modelName: '1.3.6.1.2.1.47.1.1.1.1.13',
} as const;
/** entPhysicalClass values (ENTITY-MIB PhysicalClass). */
const CHASSIS = 3;
const STACK = 11;
/** Upper bound on entPhysicalTable rows read to find the chassis; a C9300 stack has a few dozen. */
export const ENTITY_WALK_MAX_ROWS = 512;

export const DISCOVERY_SNMP_PORT = boundedInt(process.env.DISCOVERY_SNMP_PORT, 161, 1, 65535);
export const DISCOVERY_SNMP_TIMEOUT_MS = boundedInt(process.env.DISCOVERY_SNMP_TIMEOUT_MS, 1500, 100, 10_000);
export const DISCOVERY_SNMP_RETRIES = boundedInt(process.env.DISCOVERY_SNMP_RETRIES, 1, 0, 3);

function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export const DISCOVERY_SNMP_FIELDS = ['sysObjectId', 'sysDescr', 'sysName', 'entityModel', 'entitySerial'] as const;
export type DiscoverySnmpFieldName = (typeof DISCOVERY_SNMP_FIELDS)[number];
export type DiscoverySnmpField = { value: string; oid: string; source: 'SNMP'; credentialId: string; observedAt: string };
export type DiscoverySnmpStatus = 'OK' | 'PARTIAL' | 'AUTH_FAILED' | 'TIMEOUT' | 'ERROR';
/** Stored in `DiscoveryResult.snmp`. */
export type DiscoverySnmpEnrichment = {
  status: DiscoverySnmpStatus;
  errorCode?: string;
  credentialId: string;
  observedAt: string;
  durationMs: number;
  fields: Partial<Record<DiscoverySnmpFieldName, DiscoverySnmpField>>;
};
export type DiscoverySnmpEnricher = (address: string, limiter: ProbeRunner) => Promise<DiscoverySnmpEnrichment>;

/** Raw values read from one target, before provenance is added. */
export type DiscoverySnmpReading = {
  sysObjectId?: string; sysDescr?: string; sysName?: string;
  entity?: { index: number; model?: string; serial?: string } | null;
};

/** Why enrichment did not run at all for a scan (stored on the job; the scan itself still runs). */
export type DiscoverySnmpSkipReason = 'SNMP_CREDENTIAL_UNAVAILABLE' | 'SNMP_CREDENTIAL_OUT_OF_SCOPE' | 'SNMP_V2C_DISABLED' | 'SNMP_KEYRING_UNAVAILABLE';

/** Maps a net-snmp failure to the per-target status. v2c has no auth error on the wire: a wrong community is a timeout. */
export function classifySnmpError(error: unknown): { status: 'AUTH_FAILED' | 'TIMEOUT' | 'ERROR'; errorCode: string } {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string' ? (error as { code: string }).code : '';
  if (code === 'SNMP_TIMEOUT' || name === 'RequestTimedOutError' || /time(d)?[\s_-]?out/i.test(message)) return { status: 'TIMEOUT', errorCode: 'SNMP_TIMEOUT' };
  if (/authori[sz]ation|authentication|unknown user|wrong digest|usmStats|decryption|not in time window/i.test(message)) return { status: 'AUTH_FAILED', errorCode: 'SNMP_AUTHENTICATION_FAILED' };
  if (/^SNMP_[A-Z0-9_]+$/.test(code)) return { status: 'ERROR', errorCode: code };
  return { status: 'ERROR', errorCode: 'SNMP_EXECUTION_FAILED' };
}

/** The chassis row of entPhysicalTable: the lowest-index chassis, else the lowest-index stack, else none. */
export function pickChassisIndex(rows: Array<{ index: number; physicalClass: number }>): number | null {
  const sorted = [...rows].sort((a, b) => a.index - b.index);
  return sorted.find((row) => row.physicalClass === CHASSIS)?.index ?? sorted.find((row) => row.physicalClass === STACK)?.index ?? null;
}

const clean = (value: string | undefined) => {
  const trimmed = value?.replace(/\u0000+$/g, '').trim();
  return trimmed ? trimmed.slice(0, 1024) : undefined;
};

/** Adds provenance to every value read. A reading with no value at all is an ERROR (SNMP_NO_DATA). */
export function buildEnrichment(reading: DiscoverySnmpReading, credentialId: string, observedAt: Date, durationMs: number): DiscoverySnmpEnrichment {
  const at = observedAt.toISOString();
  const fields: DiscoverySnmpEnrichment['fields'] = {};
  const put = (name: DiscoverySnmpFieldName, value: string | undefined, oid: string) => {
    const text = clean(value);
    if (text) fields[name] = { value: text, oid, source: 'SNMP', credentialId, observedAt: at };
  };
  put('sysObjectId', reading.sysObjectId, SNMP_OIDS.sysObjectId);
  put('sysDescr', reading.sysDescr, SNMP_OIDS.sysDescr);
  put('sysName', reading.sysName, SNMP_OIDS.sysName);
  if (reading.entity) {
    put('entityModel', reading.entity.model, `${ENTITY_OIDS.modelName}.${reading.entity.index}`);
    put('entitySerial', reading.entity.serial, `${ENTITY_OIDS.serialNum}.${reading.entity.index}`);
  }
  const count = Object.keys(fields).length;
  if (!count) return { status: 'ERROR', errorCode: 'SNMP_NO_DATA', credentialId, observedAt: at, durationMs, fields };
  return { status: count === DISCOVERY_SNMP_FIELDS.length ? 'OK' : 'PARTIAL', credentialId, observedAt: at, durationMs, fields };
}

export function failedEnrichment(error: unknown, credentialId: string, observedAt: Date, durationMs: number): DiscoverySnmpEnrichment {
  return { ...classifySnmpError(error), credentialId, observedAt: observedAt.toISOString(), durationMs, fields: {} };
}

/** Narrow, read-only view of a stored enrichment (for comparison and the API); invalid JSON reads as null. */
export function readEnrichment(value: unknown): DiscoverySnmpEnrichment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<DiscoverySnmpEnrichment>;
  return typeof item.status === 'string' && typeof item.credentialId === 'string' && item.fields && typeof item.fields === 'object' ? item as DiscoverySnmpEnrichment : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// net-snmp session (same protocol mapping as apps/snmp/src/client.ts; the API cannot import another app).

type Session = ReturnType<typeof snmp.createSession>;
export type DiscoveryStoredCredential = SnmpEnvelope & { id: string; version: 'V1' | 'V2C' | 'V3'; username: string | null; authProtocol: string | null; privProtocol: string | null };

function authProtocol(value: string | null) {
  const normalized = (value ?? 'SHA256').toUpperCase();
  const protocols = snmp.AuthProtocols as unknown as Record<string, number>;
  const protocol = ['SHA1', 'SHA256', 'SHA384', 'SHA512'].includes(normalized) ? protocols[normalized === 'SHA1' ? 'sha' : normalized.toLowerCase()] : undefined;
  if (protocol === undefined) throw Object.assign(new Error('SNMP_AUTH_PROTOCOL_UNSUPPORTED'), { code: 'SNMP_AUTH_PROTOCOL_UNSUPPORTED' });
  return protocol;
}
function privProtocol(value: string | null) {
  const normalized = (value ?? 'AES128').toUpperCase();
  const protocols = snmp.PrivProtocols as unknown as Record<string, number>;
  const protocol = normalized === 'AES256' ? protocols.aes256r : normalized === 'AES128' ? protocols.aes : undefined;
  if (protocol === undefined) throw Object.assign(new Error('SNMP_PRIV_PROTOCOL_UNSUPPORTED'), { code: 'SNMP_PRIV_PROTOCOL_UNSUPPORTED' });
  return protocol;
}

type Secret = Record<string, string>;
function openSession(address: string, port: number, timeout: number, retries: number, credential: DiscoveryStoredCredential, secret: Secret): Session {
  if (isIP(address) !== 4) throw Object.assign(new Error('SNMP_MANAGEMENT_TARGET_INVALID'), { code: 'SNMP_MANAGEMENT_TARGET_INVALID' });
  const options = { port, timeout, retries, transport: 'udp4' } as Record<string, unknown>;
  if (credential.version === 'V2C') return snmp.createSession(address, secret.community, { ...options, version: snmp.Version2c } as snmp.SessionOptions);
  if (credential.version !== 'V3') throw Object.assign(new Error('SNMP_VERSION_UNSUPPORTED'), { code: 'SNMP_VERSION_UNSUPPORTED' });
  return snmp.createV3Session(address, {
    name: secret.username ?? credential.username ?? '', level: snmp.SecurityLevel.authPriv,
    authProtocol: authProtocol(credential.authProtocol), authKey: secret.authKey,
    privProtocol: privProtocol(credential.privProtocol), privKey: secret.privKey,
  } as snmp.User, options as snmp.SessionOptionsV3) as Session;
}

const text = (value: unknown) => Buffer.isBuffer(value) ? value.toString('utf8') : value === null || value === undefined ? undefined : String(value);
const isValue = (varbind: { type?: number }) => !snmp.isVarbindError(varbind as snmp.Varbind);

function get(session: Session, oids: string[]) {
  return new Promise<snmp.Varbind[]>((resolve, reject) => session.get(oids, (error, varbinds) => error ? reject(error) : resolve(varbinds ?? [])));
}

/** Reads entPhysicalClass with GETBULK, stopping after ENTITY_WALK_MAX_ROWS rows. A device without ENTITY-MIB gives []. */
function walkPhysicalClass(session: Session) {
  return new Promise<Array<{ index: number; physicalClass: number }>>((resolve, reject) => {
    const rows: Array<{ index: number; physicalClass: number }> = [];
    session.subtree(ENTITY_OIDS.physicalClass, 25, (varbinds: snmp.Varbind[]) => {
      for (const varbind of varbinds) {
        if (!isValue(varbind)) continue;
        const index = Number(String(varbind.oid).split('.').at(-1));
        if (Number.isInteger(index)) rows.push({ index, physicalClass: Number(varbind.value) });
      }
      return rows.length >= ENTITY_WALK_MAX_ROWS;
    }, (error?: Error | null) => error ? reject(error) : resolve(rows));
  });
}

/** One target: system group, then the chassis entity. A failure after the system group keeps what was read (PARTIAL). */
async function readTarget(session: Session): Promise<DiscoverySnmpReading> {
  const [descr, objectId, name] = await get(session, [SNMP_OIDS.sysDescr, SNMP_OIDS.sysObjectId, SNMP_OIDS.sysName]);
  const reading: DiscoverySnmpReading = {
    sysDescr: descr && isValue(descr) ? text(descr.value) : undefined,
    sysObjectId: objectId && isValue(objectId) ? text(objectId.value) : undefined,
    sysName: name && isValue(name) ? text(name.value) : undefined,
  };
  try {
    const index = pickChassisIndex(await walkPhysicalClass(session));
    if (index !== null) {
      const [model, serial] = await get(session, [`${ENTITY_OIDS.modelName}.${index}`, `${ENTITY_OIDS.serialNum}.${index}`]);
      reading.entity = { index, model: model && isValue(model) ? text(model.value) : undefined, serial: serial && isValue(serial) ? text(serial.value) : undefined };
    }
  } catch { reading.entity = null; /* ENTITY-MIB is optional; the system group is still useful. */ }
  return reading;
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('SNMP_TIMEOUT'), { code: 'SNMP_TIMEOUT' })), ms); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export type EnricherOptions = { port?: number; timeoutMs?: number; retries?: number; now?: () => Date };

/**
 * Builds the enricher for one scan. The credential is decrypted once here; the secret stays in this closure.
 * Each call takes one limiter slot for the whole exchange with that target (one UDP socket).
 */
export function createDiscoverySnmpEnricher(credential: DiscoveryStoredCredential, keyring: SnmpKeyring, options: EnricherOptions = {}): DiscoverySnmpEnricher {
  const secret = decryptCredential(credential, keyring);
  const port = options.port ?? DISCOVERY_SNMP_PORT;
  const timeout = options.timeoutMs ?? DISCOVERY_SNMP_TIMEOUT_MS;
  const retries = options.retries ?? DISCOVERY_SNMP_RETRIES;
  const now = options.now ?? (() => new Date());
  // Worst case: system GET + up to ~21 bulk pages + model/serial GET, each with retries; keeps a wedged target bounded.
  const deadlineMs = timeout * (retries + 1) * 4 + 1000;
  return (address, limiter) => limiter.run(async () => {
    const started = now();
    let session: Session | undefined;
    try {
      session = openSession(address, port, timeout, retries, credential, secret);
      const reading = await withDeadline(readTarget(session), deadlineMs);
      return buildEnrichment(reading, credential.id, started, now().getTime() - started.getTime());
    } catch (error) {
      return failedEnrichment(error, credential.id, started, now().getTime() - started.getTime());
    } finally {
      try { session?.close(); } catch { /* already closed */ }
    }
  });
}

/**
 * Loads the scan's credential and checks it is still usable: a READ credential, enabled, owned by a device on the
 * subnet's Site. Anything else skips enrichment for the whole scan (the scan still runs) with the reason.
 */
export async function loadDiscoverySnmpEnricher(
  prisma: Pick<PrismaClient, 'snmpCredential'>, credentialId: string, subnetSiteId: string | null,
  deps: { keyring?: () => SnmpKeyring; options?: EnricherOptions } = {},
): Promise<{ enricher: DiscoverySnmpEnricher } | { skipped: DiscoverySnmpSkipReason }> {
  const credential = await prisma.snmpCredential.findUnique({ where: { id: credentialId }, include: { device: { select: { siteId: true } } } });
  if (!credential || credential.purpose !== 'READ' || !credential.enabled) return { skipped: 'SNMP_CREDENTIAL_UNAVAILABLE' };
  if (!subnetSiteId || credential.device.siteId !== subnetSiteId) return { skipped: 'SNMP_CREDENTIAL_OUT_OF_SCOPE' };
  if (credential.version === 'V2C' && !snmpV2cAllowed()) return { skipped: 'SNMP_V2C_DISABLED' };
  if (credential.version !== 'V2C' && credential.version !== 'V3') return { skipped: 'SNMP_CREDENTIAL_UNAVAILABLE' };
  let keyring: SnmpKeyring;
  try { keyring = (deps.keyring ?? (() => loadKeyring()))(); } catch { return { skipped: 'SNMP_KEYRING_UNAVAILABLE' }; }
  try {
    return { enricher: createDiscoverySnmpEnricher(credential as unknown as DiscoveryStoredCredential, keyring, deps.options) };
  } catch { return { skipped: 'SNMP_KEYRING_UNAVAILABLE' }; }
}
