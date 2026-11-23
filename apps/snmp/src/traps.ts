import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import * as snmp from 'net-snmp';
import { decryptStoredCredential, snmpAuthProtocol, snmpPrivProtocol } from './client';
import { SNMP_JOB_NAMES, SNMP_V2C_DISABLED, chooseEngineId, decodeTrap, snmpPayload, snmpV2cAllowed } from '@simoes/snmp-core';
import { log } from './log';

export { classifyTrap } from '@simoes/snmp-core';
export function isSupportedNotificationPdu(type: unknown) {
  return Number(type) === Number((snmp.PduType as any).TrapV2)
    || Number(type) === Number((snmp.PduType as any).InformRequest);
}

function normalizedValue(value: unknown) {
  if (Buffer.isBuffer(value)) return { encoding: 'hex', value: value.toString('hex') };
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return null;
  return value;
}
function fingerprint(value: string) { return createHash('sha256').update(value).digest('hex'); }

export function snmpSelfTestProxySources(enabled = process.env.SNMP_SELF_TEST_ENABLED, configured = process.env.SNMP_SELF_TEST_PROXY_SOURCES) {
  if (enabled !== 'true') return [];
  return [...new Set((configured ?? '').split(',').map((value) => value.trim()).filter((value) => isIP(value) === 4))];
}

export function snmpSelfTestSourceAllowed(
  sourceAddress: string,
  enabled = process.env.SNMP_SELF_TEST_ENABLED,
  configured = process.env.SNMP_SELF_TEST_PROXY_SOURCES,
  allowTranslated = process.env.SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE,
) {
  if (enabled !== 'true' || isIP(sourceAddress) !== 4) return false;
  return snmpSelfTestProxySources(enabled, configured).includes(sourceAddress) || allowTranslated === 'true';
}

export type SnmpRuntimeInterface = { instanceId: string; name: string; address: string; internal: boolean };
type SelectedInterface = { instanceId: string; name: string; address: string };

export function runtimeIpv4Interfaces(instanceId: string, interfaces = networkInterfaces()): SnmpRuntimeInterface[] {
  return Object.entries(interfaces).flatMap(([name, addresses]) => (addresses ?? []).flatMap((item) => {
    const family = String(item.family);
    return family === 'IPv4' || family === '4' ? [{ instanceId, name, address: item.address, internal: item.internal }] : [];
  })).sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
}

export function configuredListenerAddresses(listenAll: boolean, selected: unknown, current: SnmpRuntimeInterface[]) {
  if (listenAll) return [process.env.SNMP_TRAP_ADDRESS?.trim() || '0.0.0.0'];
  if (!Array.isArray(selected)) return [];
  return [...new Set(current.filter((item) => selected.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const value = candidate as SelectedInterface;
    return value.instanceId === item.instanceId && value.name === item.name && value.address === item.address;
  })).map((item) => item.address))];
}

export function selfTestExpectedAddresses(listenAll: boolean, selected: unknown, current: SnmpRuntimeInterface[]) {
  if (listenAll) return [...new Set(current.map((item) => item.address))];
  if (!Array.isArray(selected)) return [];
  return [...new Set(current.filter((item) => selected.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const value = candidate as SelectedInterface;
    return value.instanceId === item.instanceId && value.name === item.name && value.address === item.address;
  })).map((item) => item.address))];
}

/** Phase 1 step 2: at most one REJECTED row per source IP per window, so a misconfigured or hostile sender cannot flood the table. */
export const REJECTED_TRAP_WINDOW_MS = 60_000;
/** REJECTED rows carry no payload and only feed the per-source alert (24 h window), so they are kept 7 days, not 90. */
export const REJECTED_TRAP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TRAP_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** Global cap on rows written for untrusted traps (REJECTED + UNMATCHED) per minute, whatever the number of source IPs. */
export function untrustedTrapRowsPerMinute(value = process.env.SNMP_TRAP_UNTRUSTED_ROWS_PER_MINUTE) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100_000 ? parsed : 120;
}

/** net-snmp message version (0 = v1, 1 = v2c, 3 = v3) to the stored trap version. */
export function trapPduVersion(pdu: { version?: unknown; user?: unknown; securityName?: unknown }): 'V1' | 'V2C' | 'V3' {
  if (Number(pdu.version) === Number(snmp.Version3) || pdu.user || pdu.securityName) return 'V3';
  if (pdu.version !== undefined && Number(pdu.version) === Number(snmp.Version1)) return 'V1';
  return 'V2C';
}

export type TrapRejectionCode = 'SNMP_TRAP_UNKNOWN_USER' | 'SNMP_TRAP_UNKNOWN_COMMUNITY' | 'SNMP_TRAP_AUTH_FAILED' | 'SNMP_TRAP_VERSION_UNSUPPORTED' | 'SNMP_TRAP_RATE_LIMITED' | typeof SNMP_V2C_DISABLED;

/**
 * Maps a net-snmp receiver error to a stable code and the SNMP version it came in. The message can contain the
 * offered community or user name; only the code is kept, never the message.
 */
export function classifyTrapRejection(error: unknown, v2cAllowed = snmpV2cAllowed()): { errorCode: TrapRejectionCode; version: 'V2C' | 'V3' } {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/community/i.test(message)) return { errorCode: v2cAllowed ? 'SNMP_TRAP_UNKNOWN_COMMUNITY' : SNMP_V2C_DISABLED, version: 'V2C' };
  if (/user .*not found|not found .*user|Local user not found/i.test(message)) return { errorCode: 'SNMP_TRAP_UNKNOWN_USER', version: 'V3' };
  return { errorCode: 'SNMP_TRAP_AUTH_FAILED', version: 'V3' };
}

export class TrapReceiver {
  private receivers: any[] = [];
  private boundAddresses: string[] = [];
  private refreshPromise: Promise<void> | undefined;
  private containerInventoryCleaned = false;
  private readonly instanceId = process.env.SNMP_INSTANCE_ID?.trim() || hostname();
  private readonly limits = new Map<string, { window: number; count: number }>();
  private readonly rejectedAt = new Map<string, number>();
  private untrustedWindow = { start: 0, written: 0, dropped: 0 };
  private untrustedDroppedTotal = 0;
  private engineId: string | undefined;
  ready = false;

  constructor(private readonly prisma: PrismaClient, private readonly queue: Queue) {}

  async start() {
    await this.refresh();
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async performRefresh() {
    const containerIngress = process.env.SNMP_LISTENER_MODE === 'container-ingress';
    let addresses: string[];
    if (containerIngress) {
      if (!this.containerInventoryCleaned) {
        await this.prisma.snmpListenerInterface.deleteMany({ where: { instanceId: this.instanceId } });
        this.containerInventoryCleaned = true;
      }
      addresses = [process.env.SNMP_TRAP_ADDRESS?.trim() || '0.0.0.0'];
    } else {
      const runtimeInterfaces = runtimeIpv4Interfaces(this.instanceId);
      const now = new Date();
      await Promise.all(runtimeInterfaces.map((item) => this.prisma.snmpListenerInterface.upsert({
        where: { instanceId_name_address: { instanceId: item.instanceId, name: item.name, address: item.address } },
        create: { ...item, lastSeenAt: now },
        update: { internal: item.internal, lastSeenAt: now },
      })));
      await this.prisma.snmpListenerInterface.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
      const config = await this.prisma.snmpListenerConfig.findUnique({ where: { id: 'default' } });
      addresses = configuredListenerAddresses(config?.listenAll ?? true, config?.selectedInterfaces, runtimeInterfaces);
    }
    if (!addresses.length) {
      this.ready = false;
      await this.closeReceivers();
      log('warn', 'no configured SNMP listener is available', { instanceId: this.instanceId, errorCode: 'SNMP_LISTENER_UNAVAILABLE' });
      return;
    }
    if (!this.engineId) this.engineId = await this.resolveEngineId();
    if (addresses.join('\0') !== this.boundAddresses.join('\0')) await this.bind(addresses);
    await this.reloadCredentials();
    this.ready = true;
  }

  /**
   * Phase 1 step 2: one SNMPv3 engine ID per install. SNMP_ENGINE_ID wins unless it is the old shared compose default;
   * otherwise the ID stored on SnmpListenerConfig; otherwise a new one is generated and stored once (first writer wins).
   * The ID in use and its source are then always persisted (activeEngineId/activeEngineIdSource) so the API reports what
   * this receiver uses, whatever env the API container has. An env override never replaces the stored install ID.
   */
  async resolveEngineId() {
    const stored = await this.prisma.snmpListenerConfig.findUnique({ where: { id: 'default' }, select: { engineId: true } });
    const choice = chooseEngineId(process.env.SNMP_ENGINE_ID, stored?.engineId);
    let engineId = choice.engineId;
    if (choice.source === 'GENERATED') {
      if (!stored) await this.prisma.snmpListenerConfig.create({ data: { id: 'default', engineId: choice.engineId } }).catch(() => undefined);
      else await this.prisma.snmpListenerConfig.updateMany({ where: { id: 'default', engineId: stored.engineId }, data: { engineId: choice.engineId } });
      const saved = await this.prisma.snmpListenerConfig.findUnique({ where: { id: 'default' }, select: { engineId: true } });
      engineId = chooseEngineId(undefined, saved?.engineId, () => choice.engineId).engineId;
      log('info', 'SNMP engine ID generated for this install', { engineId });
    }
    const activeEngineIdSource = choice.source === 'ENV' ? 'ENV' : 'STORED';
    await this.prisma.snmpListenerConfig.upsert({ where: { id: 'default' }, create: { id: 'default', activeEngineId: engineId, activeEngineIdSource }, update: { activeEngineId: engineId, activeEngineIdSource } })
      .catch((error: unknown) => log('warn', 'could not record the SNMP engine ID in use', { errorCode: 'SNMP_ENGINE_ID_PERSIST_FAILED', error: error instanceof Error ? error.message : String(error) }));
    return engineId;
  }

  currentEngineId() { return this.engineId; }

  private async bind(addresses: string[]) {
    this.ready = false;
    await this.closeReceivers();
    const options = {
      port: Number(process.env.SNMP_TRAP_PORT ?? 1162),
      transport: 'udp4',
      disableAuthorization: false,
      includeAuthentication: true,
      ...(this.engineId ? { engineID: this.engineId } : {}),
    } as any;
    try {
      for (const address of addresses) {
        // net-snmp reports authentication failures without the sender; remember it for the synchronous error callback.
        let current: { address: string; port: number } | undefined;
        const receiver = snmp.createReceiver({ ...options, address }, (error: Error | null, notification: any) => {
          if (error) {
            const source = (error as any)?.rinfo ?? current;
            log('warn', 'trap rejected', { errorCode: 'SNMP_TRAP_REJECTED', sourceAddress: source?.address });
            if (source?.address) void this.recordRejected(String(source.address), Number(source.port ?? 0), classifyTrapRejection(error)).catch(() => log('error', 'rejected trap persistence failed', { errorCode: 'SNMP_TRAP_PERSIST_FAILED' }));
            return;
          }
          void this.persist(notification).catch(() => log('error', 'trap persistence failed', { errorCode: 'SNMP_TRAP_PERSIST_FAILED' }));
        });
        this.receivers.push(receiver);
        await this.waitForSocket(receiver);
        for (const socket of Object.values(receiver?.listener?.sockets ?? {}) as any[]) {
          socket.prependListener?.('message', (_buffer: Buffer, rinfo: { address: string; port: number }) => { current = rinfo; });
          socket.on?.('message', () => { current = undefined; });
        }
      }
      this.boundAddresses = [...addresses];
      log('info', 'trap receiver ready', { port: options.port, addresses });
    } catch (error) {
      await this.closeReceivers();
      throw error;
    }
  }

  private async waitForSocket(receiver: any) {
    const sockets = Object.values(receiver?.listener?.sockets ?? {}) as Array<{
      address: () => unknown;
      once: (event: string, callback: (error?: Error) => void) => void;
    }>;
    if (!sockets.length) throw Object.assign(new Error('SNMP_TRAP_SOCKET_UNAVAILABLE'), { code: 'SNMP_TRAP_SOCKET_UNAVAILABLE' });
    await Promise.all(sockets.map((socket) => new Promise<void>((resolve, reject) => {
      try { socket.address(); resolve(); }
      catch {
        socket.once('listening', () => resolve());
        socket.once('error', (error) => reject(error));
      }
    })));
  }

  async reloadCredentials() {
    await this.cleanupExpiredEnrollments();
    if (!this.receivers.length) return;
    const [credentials, enrollments] = await Promise.all([
      this.prisma.snmpCredential.findMany({ where: { purpose: 'TRAP', enabled: true } }),
      this.prisma.snmpTrapEnrollment.findMany({ where: { status: { in: ['WAITING', 'DISCOVERED'] }, expiresAt: { gt: new Date() } } }),
    ]);
    for (const receiver of this.receivers) {
      const authorizer = receiver.getAuthorizer();
      for (const community of authorizer.getCommunities?.() ?? []) authorizer.deleteCommunity(community);
      for (const user of authorizer.getUsers?.() ?? []) authorizer.deleteUser(user.name);
      const communities = new Set<string>();
      const usernames = new Set<string>();
      for (const credential of [...credentials, ...enrollments]) {
        try {
          // Plan step 1.3 (rev. 4): with SNMP_ALLOW_V2C=false no community is loaded, so every v2c trap is refused and recorded as REJECTED.
          if (credential.version === 'V2C' && !snmpV2cAllowed()) continue;
          const secret = decryptStoredCredential(credential as any);
          if (credential.version === 'V2C') {
            if (!communities.has(secret.community)) { authorizer.addCommunity(secret.community); communities.add(secret.community); }
          } else {
            const username = secret.username ?? credential.username ?? '';
            if (!username) throw new Error('SNMP_TRAP_USERNAME_REQUIRED');
            if (!usernames.has(username)) {
              authorizer.addUser({ name: username, level: snmp.SecurityLevel.authPriv, authProtocol: snmpAuthProtocol(credential.authProtocol), authKey: secret.authKey, privProtocol: snmpPrivProtocol(credential.privProtocol), privKey: secret.privKey });
              usernames.add(username);
            }
          }
        } catch { log('warn', 'trap credential unavailable', { credentialId: credential.id, errorCode: 'SNMP_CREDENTIAL_DECRYPT_FAILED' }); }
      }
    }
  }

  private async cleanupExpiredEnrollments() {
    const expired = await this.prisma.snmpTrapEnrollment.findMany({
      where: { status: { in: ['WAITING', 'DISCOVERED'] }, expiresAt: { lte: new Date() } },
      select: { id: true, siteId: true, sourceAddress: true },
      take: 500,
    });
    for (const enrollment of expired) {
      await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.snmpTrapEnrollment.deleteMany({ where: { id: enrollment.id, expiresAt: { lte: new Date() } } });
        if (deleted.count) await tx.auditLog.create({ data: { action: 'SNMP_TRAP_ENROLLMENT_EXPIRED', entityType: 'SnmpTrapEnrollment', entityId: enrollment.id, metadata: { siteId: enrollment.siteId, sourceAddress: enrollment.sourceAddress } } });
      });
    }
  }

  private allowed(address: string) {
    const now = Date.now();
    const current = this.limits.get(address);
    if (!current || now - current.window > 60_000) {
      if (!current && this.limits.size >= Number(process.env.SNMP_TRAP_SOURCE_LIMIT ?? 10_000)) {
        for (const [source, entry] of this.limits) if (now - entry.window > 60_000) this.limits.delete(source);
        if (this.limits.size >= Number(process.env.SNMP_TRAP_SOURCE_LIMIT ?? 10_000)) return false;
      }
      this.limits.set(address, { window: now, count: 1 }); return true;
    }
    current.count++;
    return current.count <= Number(process.env.SNMP_TRAP_RATE_LIMIT ?? 120);
  }

  /**
   * Phase 1 review: one global per-minute budget (SNMP_TRAP_UNTRUSTED_ROWS_PER_MINUTE, default 120) shared by REJECTED
   * rows and new non-self-test UNMATCHED rows: per-source limits alone let rotating (spoofed) source IPs write
   * thousands of rows a minute. Over budget the trap is only counted; the count is logged once per minute and exposed
   * as the snmp_trap_untrusted_rows_dropped_total metric.
   */
  takeUntrustedRowBudget(now = Date.now()) {
    if (now - this.untrustedWindow.start >= 60_000) {
      if (this.untrustedWindow.dropped) log('warn', 'untrusted SNMP trap rows dropped over the per-minute budget', { errorCode: 'SNMP_TRAP_UNTRUSTED_BUDGET', dropped: this.untrustedWindow.dropped, budget: untrustedTrapRowsPerMinute() });
      this.untrustedWindow = { start: now, written: 0, dropped: 0 };
    }
    if (this.untrustedWindow.written >= untrustedTrapRowsPerMinute()) {
      this.untrustedWindow.dropped++;
      this.untrustedDroppedTotal++;
      return false;
    }
    this.untrustedWindow.written++;
    return true;
  }

  untrustedRowsDropped() { return this.untrustedDroppedTotal; }

  /**
   * Phase 1 step 2: stores a refused trap as REJECTED (no varbinds, no identity, the PDU's real version) so the API can
   * raise one alert per source IP. At most one row per source per REJECTED_TRAP_WINDOW_MS, at most
   * SNMP_TRAP_SOURCE_LIMIT tracked sources, and only while the shared untrusted-row budget allows; rows expire after
   * REJECTED_TRAP_RETENTION_MS (7 days). Returns whether a row was written; refused ones are only logged/counted.
   */
  async recordRejected(sourceAddress: string, sourcePort: number, rejection: { errorCode: string; version: 'V1' | 'V2C' | 'V3' }, now = Date.now()) {
    if (!sourceAddress) return false;
    const last = this.rejectedAt.get(sourceAddress);
    if (last !== undefined && now - last < REJECTED_TRAP_WINDOW_MS) return false;
    if (last === undefined && this.rejectedAt.size >= Number(process.env.SNMP_TRAP_SOURCE_LIMIT ?? 10_000)) {
      for (const [source, at] of this.rejectedAt) if (now - at >= REJECTED_TRAP_WINDOW_MS) this.rejectedAt.delete(source);
      if (this.rejectedAt.size >= Number(process.env.SNMP_TRAP_SOURCE_LIMIT ?? 10_000)) return false;
    }
    if (!this.takeUntrustedRowBudget(now)) return false;
    this.rejectedAt.set(sourceAddress, now);
    await this.prisma.snmpTrapEvent.create({ data: { sourceAddress, sourcePort, version: rejection.version, authIdentity: fingerprint(''), pduType: 'REJECTED', varbinds: [], status: 'REJECTED', errorCode: rejection.errorCode, expiresAt: new Date(now + REJECTED_TRAP_RETENTION_MS) } });
    return true;
  }

  private async persist(notification: any) {
    const pdu = notification.pdu ?? {}; const rinfo = notification.rinfo ?? {};
    const sourceAddress = String(rinfo.address ?? '');
    if (!isSupportedNotificationPdu(pdu.type)) {
      log('warn', 'unsupported notification rejected', { errorCode: 'SNMP_VERSION_UNSUPPORTED' });
      await this.recordRejected(sourceAddress, Number(rinfo.port ?? 0), { errorCode: 'SNMP_TRAP_VERSION_UNSUPPORTED', version: trapPduVersion(pdu) });
      return;
    }
    if (!this.allowed(sourceAddress)) {
      await this.recordRejected(sourceAddress, Number(rinfo.port ?? 0), { errorCode: 'SNMP_TRAP_RATE_LIMITED', version: trapPduVersion(pdu) });
      return;
    }
    if (!Array.isArray(pdu.varbinds) || pdu.varbinds.length > 128) return;
    const rawIdentity = String(pdu.community ?? pdu.user?.name ?? pdu.user ?? pdu.securityName ?? '');
    const version = trapPduVersion(pdu);
    if (version === 'V1') {
      await this.recordRejected(sourceAddress, Number(rinfo.port ?? 0), { errorCode: 'SNMP_TRAP_VERSION_UNSUPPORTED', version });
      return;
    }
    if (version === 'V2C' && !snmpV2cAllowed()) {
      await this.recordRejected(sourceAddress, Number(rinfo.port ?? 0), { errorCode: SNMP_V2C_DISABLED, version });
      return;
    }
    const [devices, enrollments] = await Promise.all([
      this.prisma.device.findMany({ where: { managementIp: sourceAddress }, include: { snmpCredentials: { where: { purpose: 'TRAP', enabled: true } } } }),
      this.prisma.snmpTrapEnrollment.findMany({ where: { sourceAddress, status: { in: ['WAITING', 'DISCOVERED'] }, expiresAt: { gt: new Date() } } }),
    ]);
    let matchedCredentialId: string | undefined;
    let matchedDeviceId: string | undefined;
    for (const device of devices) {
      for (const credential of device.snmpCredentials) {
        if (credential.version !== version) continue;
        try {
          const secret = decryptStoredCredential(credential as any);
          const expected = version === 'V2C' ? secret.community : secret.username ?? credential.username;
          if (expected === rawIdentity) { matchedCredentialId = credential.id; matchedDeviceId = device.id; break; }
        } catch {
          log('warn', 'trap credential unavailable during association', { credentialId: credential.id, errorCode: 'SNMP_CREDENTIAL_DECRYPT_FAILED' });
        }
      }
      if (matchedCredentialId) break;
    }
    let matchedEnrollment: (typeof enrollments)[number] | undefined;
    let selfTestSourceMapped = false;
    if (!matchedCredentialId) {
      for (const enrollment of enrollments) {
        if (enrollment.version !== version) continue;
        try {
          const secret = decryptStoredCredential(enrollment as any);
          const expected = version === 'V2C' ? secret.community : secret.username ?? enrollment.username;
          if (expected === rawIdentity) { matchedEnrollment = enrollment; break; }
        } catch {
          log('warn', 'trap enrollment unavailable during association', { enrollmentId: enrollment.id, errorCode: 'SNMP_CREDENTIAL_DECRYPT_FAILED' });
        }
      }
    }
    if (!matchedCredentialId && !matchedEnrollment && version === 'V3' && snmpSelfTestSourceAllowed(sourceAddress)) {
      const [freshHostInterfaces, listenerConfig] = await Promise.all([
        this.prisma.snmpListenerInterface.findMany({
          where: {
            instanceId: { startsWith: 'host:' },
            lastSeenAt: { gte: new Date(Date.now() - 2 * 60_000) },
          },
          select: { instanceId: true, name: true, address: true, internal: true },
        }),
        this.prisma.snmpListenerConfig.findUnique({ where: { id: 'default' }, select: { listenAll: true, selectedInterfaces: true } }),
      ]);
      const localAddresses = selfTestExpectedAddresses(listenerConfig?.listenAll ?? true, listenerConfig?.selectedInterfaces, freshHostInterfaces)
        .filter((address) => isIP(address) === 4);
      if (localAddresses.length) {
        const candidates = await this.prisma.snmpTrapEnrollment.findMany({
          where: {
            sourceAddress: { in: localAddresses },
            version: 'V3',
            username: rawIdentity,
            status: { in: ['WAITING', 'DISCOVERED'] },
            expiresAt: { gt: new Date() },
          },
        });
        const identityMatches = [];
        for (const enrollment of candidates) {
          try {
            const secret = decryptStoredCredential(enrollment as any);
            if ((secret.username ?? enrollment.username) === rawIdentity) identityMatches.push(enrollment);
          } catch {
            log('warn', 'trap enrollment unavailable during self-test association', { enrollmentId: enrollment.id, errorCode: 'SNMP_CREDENTIAL_DECRYPT_FAILED' });
          }
        }
        if (identityMatches.length === 1) {
          matchedEnrollment = identityMatches[0];
          selfTestSourceMapped = true;
        } else if (identityMatches.length > 1) {
          log('warn', 'ambiguous SNMP self-test trap rejected', { sourceAddress, errorCode: 'SNMP_SELF_TEST_AMBIGUOUS' });
        }
      }
    }
    const varbinds = pdu.varbinds.map((item: any) => ({ oid: String(item.oid), type: Number(item.type), value: normalizedValue(item.value) }));
    if (Buffer.byteLength(JSON.stringify(varbinds), 'utf8') > 32_768) return;
    const trapOid = varbinds.find((item: any) => item.oid === '1.3.6.1.6.3.1.1.4.1.0')?.value;
    const engineId = typeof pdu.contextEngineID === 'string'
      ? pdu.contextEngineID.toLowerCase()
      : Buffer.isBuffer(pdu.contextEngineID)
        ? pdu.contextEngineID.toString('hex')
        : undefined;
    const requestId = pdu.id === undefined ? undefined : String(pdu.id);
    const pduType = String(pdu.type ?? 'UNKNOWN');
    const isInform = Number(pdu.type) === Number((snmp.PduType as any).InformRequest);
    const dedupKey = isInform ? createHash('sha256').update(`${engineId ?? sourceAddress}:${requestId ?? ''}`).digest('hex') : undefined;
    const status = matchedCredentialId ? 'PENDING' : matchedEnrollment ? 'DISCOVERED' : 'UNMATCHED';
    if (status === 'UNMATCHED' && !selfTestSourceMapped && !this.takeUntrustedRowBudget()) return;
    const event = await this.prisma.snmpTrapEvent.create({ data: { deviceId: matchedDeviceId, credentialId: matchedCredentialId, enrollmentId: matchedEnrollment?.id, sourceAddress, sourcePort: Number(rinfo.port ?? 0), version, authIdentity: fingerprint(rawIdentity), engineId, requestId, pduType, trapOid: typeof trapOid === 'string' ? trapOid : undefined, uptimeTicks: String(varbinds.find((item: any) => item.oid === '1.3.6.1.2.1.1.3.0')?.value ?? ''), varbinds, status, category: selfTestSourceMapped ? 'SELF_TEST' : undefined, severity: selfTestSourceMapped ? 'INFO' : undefined, dedupKey, expiresAt: new Date(Date.now() + TRAP_EVENT_RETENTION_MS) } }).catch((error: any) => { if (error?.code === 'P2002' && dedupKey) return null; throw error; });
    if (event && selfTestSourceMapped && matchedEnrollment) {
      log('info', 'SNMP self-test source mapped', { sourceAddress, expectedSourceAddress: matchedEnrollment.sourceAddress, enrollmentId: matchedEnrollment.id });
    }
    if (event && matchedEnrollment) {
      const now = new Date();
      await this.prisma.snmpTrapEnrollment.update({ where: { id: matchedEnrollment.id }, data: { status: 'DISCOVERED', firstSeenAt: matchedEnrollment.firstSeenAt ?? now, lastSeenAt: now, trapCount: { increment: 1 }, latestTrapOid: typeof trapOid === 'string' ? trapOid : undefined } });
    }
    if (event?.status === 'PENDING') {
      await this.prisma.snmpCredential.update({ where: { id: matchedCredentialId! }, data: { lastUsedAt: new Date() } });
      await this.queue.add(SNMP_JOB_NAMES.processTrap, snmpPayload(event.id), { jobId: event.id, removeOnComplete: 500, removeOnFail: 500 }).catch(() => undefined);
    }
  }

  async process(eventId: string) {
    const event = await this.prisma.snmpTrapEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== 'PENDING') return;
    // Catalog + varbind decoding; unknown OIDs stay VENDOR/INFO and varbinds are never rewritten.
    const mapped = decodeTrap(event.trapOid, event.varbinds);
    await this.prisma.$transaction([
      this.prisma.snmpTrapEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), category: mapped.category, severity: mapped.severity } }),
      this.prisma.auditLog.create({ data: { action: 'SNMP_TRAP_PROCESSED', entityType: 'SnmpTrapEvent', entityId: event.id, metadata: { deviceId: event.deviceId, credentialId: event.credentialId, category: mapped.category, severity: mapped.severity, sourceAddress: event.sourceAddress } } }),
    ]);
  }

  async recoverPending() {
    const events = await this.prisma.snmpTrapEvent.findMany({ where: { status: 'PENDING' }, select: { id: true }, take: 500 });
    for (const event of events) await this.queue.add(SNMP_JOB_NAMES.processTrap, snmpPayload(event.id), { jobId: event.id, removeOnComplete: 500, removeOnFail: 500 }).catch(() => undefined);
  }

  private async closeReceivers() {
    const receivers = this.receivers.splice(0);
    this.boundAddresses = [];
    await Promise.all(receivers.map((receiver) => new Promise<void>((resolve) => receiver.close(() => resolve()))));
  }

  async close() { this.ready = false; await this.closeReceivers(); }
}
