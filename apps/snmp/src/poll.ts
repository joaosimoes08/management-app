import { Prisma, PrismaClient } from '@simoes/database';
import { SNMP_JOB_NAMES } from '@simoes/snmp-core';
import { createSnmpSession, get, pollLldp, pollStandard, withDeadline } from './client';
import { healthRecord, pollDeviceHealth } from './device-health';
import { DeviceLocks } from './locks';
import { log, publicErrorCode } from './log';

/** Extra time past the device timeout before the worker gives up on a credential test request. */
export const CREDENTIAL_TEST_DEADLINE_MARGIN_MS = 2_000;

export class PollProcessor {
  constructor(private readonly prisma: PrismaClient, private readonly locks: DeviceLocks) {}

  async scheduled(configId: string) {
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { id: configId } });
    if (!config?.enabled) return;
    const credential = await this.prisma.snmpCredential.findUnique({ where: { deviceId_purpose: { deviceId: config.deviceId, purpose: 'READ' } } });
    if (!credential?.enabled) {
      // Round 2 #12: record why scheduled polling stopped, so the fleet summary and Alertas show it instead of a silent gap.
      await this.prisma.snmpDeviceConfig.update({ where: { id: config.id }, data: { lastStatus: 'FAILED', lastErrorCode: 'SNMP_READ_CREDENTIAL_REQUIRED' } }).catch(() => undefined);
      throw Object.assign(new Error('SNMP_READ_CREDENTIAL_REQUIRED'), { code: 'SNMP_READ_CREDENTIAL_REQUIRED' });
    }
    const job = await this.prisma.snmpJob.create({ data: { deviceId: config.deviceId, credentialId: credential.id, type: 'POLL', metadata: { trigger: 'SCHEDULED', contract: SNMP_JOB_NAMES.poll } } });
    try { return await this.run(job.id); }
    catch (error) {
      if (publicErrorCode(error) !== 'SNMP_DEVICE_BUSY') throw error;
      return this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_DEVICE_BUSY' } });
    }
  }

  async test(jobId: string) {
    const job = await this.prisma.snmpJob.findUnique({ where: { id: jobId }, include: { device: true, credential: true } });
    if (!job?.credential || !job.device.managementIp) throw new Error('SNMP_JOB_INVALID');
    // P0-3 follow-up: only a PENDING job starts; the API closes tests past their deadline, and a late worker must not reopen them.
    const claimed = await this.prisma.snmpJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claimed.count) return { skipped: true };
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId: job.deviceId } });
    const timeoutMs = config?.timeoutMs ?? 5000;
    let session: ReturnType<typeof createSnmpSession> | undefined;
    const startedAt = Date.now();
    try {
      session = createSnmpSession(job.device.managementIp, config?.port ?? 161, timeoutMs, 0, job.credential as any);
      const values = await withDeadline(get(session, ['1.3.6.1.2.1.1.5.0']), timeoutMs + CREDENTIAL_TEST_DEADLINE_MARGIN_MS);
      await this.prisma.$transaction([
        this.prisma.snmpJob.updateMany({ where: { id: job.id, status: 'RUNNING' }, data: { status: 'COMPLETED', completedAt: new Date(), result: credentialTestResult(values, startedAt) } }),
        this.prisma.snmpCredential.update({ where: { id: job.credential.id }, data: { lastTestedAt: new Date(), lastTestStatus: 'COMPLETED', lastUsedAt: new Date() } }),
        this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_CREDENTIAL_TEST_COMPLETED', entityType: 'SnmpCredential', entityId: job.credential.id, metadata: { deviceId: job.deviceId, jobId: job.id } } }),
      ]);
      return { valueReceived: Boolean(values.length) };
    } catch (error) {
      const code = publicErrorCode(error);
      await this.prisma.$transaction([
        this.prisma.snmpJob.updateMany({ where: { id: job.id, status: 'RUNNING' }, data: { status: 'FAILED', completedAt: new Date(), errorCode: code, result: { reachable: false, durationMs: Date.now() - startedAt } } }),
        this.prisma.snmpCredential.update({ where: { id: job.credential.id }, data: { lastTestedAt: new Date(), lastTestStatus: 'FAILED' } }),
        this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_CREDENTIAL_TEST_FAILED', entityType: 'SnmpCredential', entityId: job.credential.id, metadata: { deviceId: job.deviceId, jobId: job.id, errorCode: code } } }),
      ]);
      throw error;
    } finally { session?.close(); }
  }

  async run(jobId: string) {
    const job = await this.prisma.snmpJob.findUnique({ where: { id: jobId }, include: { device: true, credential: true } });
    if (!job?.credential || !job.device.managementIp) throw new Error('SNMP_JOB_INVALID');
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId: job.deviceId } });
    if (!config?.enabled) return this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_NOT_ENABLED' } });
    return this.locks.withLock(job.deviceId, Math.max(60_000, config.timeoutMs * (config.retries + 1) * 10), async () => {
      await this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date(), errorCode: null } });
      let session: ReturnType<typeof createSnmpSession> | undefined;
      try {
        session = createSnmpSession(job.device.managementIp!, config.port, config.timeoutMs, config.retries, job.credential as any);
        const result = await pollStandard(session);
        let lldp: Awaited<ReturnType<typeof pollLldp>> = [];
        try { lldp = await pollLldp(session); } catch { /* LLDP-MIB is optional; preserve the standard SNMP poll. */ }
        const existingInterfaces = await this.prisma.deviceInterface.findMany({ where: { deviceId: job.deviceId }, orderBy: { id: 'asc' }, include: { allowedVlans: { select: { vlanId: true } } } });
        const byName = new Map(existingInterfaces.flatMap((item) => [item.name, item.portKey].filter(Boolean).map((name) => [String(name).toLowerCase(), item] as const)));
        const snapshot = await this.prisma.snmpSnapshot.create({ data: { deviceId: job.deviceId, jobId: job.id, ...result.system, raw: result.raw as Prisma.InputJsonValue, interfaces: { create: result.interfaces.map((item) => ({ ...item, counters: item.counters as Prisma.InputJsonValue, deviceInterfaceId: (item.name && byName.get(item.name.toLowerCase())?.id) || (item.description && byName.get(item.description.toLowerCase())?.id) })) } } });
        await this.storeLldpObservations(job.deviceId, snapshot.id, job.device.siteId, lldp, existingInterfaces);
        await this.replaceDrifts(job.deviceId, snapshot.id, job.device, result, byName);
        await this.createTopologyProposals(job.deviceId, snapshot.id, result.interfaces, existingInterfaces, job.device.siteId);
        const healthStatus = await this.storeHealth(job.deviceId, job.id, session, result.system);
        const nextPollAt = new Date(Date.now() + config.intervalMinutes * 60 * 1000);
        await this.prisma.$transaction([
          this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), result: { snapshotId: snapshot.id, interfaceCount: result.interfaces.length, healthStatus } } }),
          this.prisma.snmpDeviceConfig.update({ where: { id: config.id }, data: { lastPollAt: new Date(), nextPollAt, lastStatus: 'COMPLETED', lastErrorCode: null, consecutiveFailures: 0 } }),
          this.prisma.snmpCredential.update({ where: { id: job.credential!.id }, data: { lastUsedAt: new Date() } }),
          this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_POLL_COMPLETED', entityType: 'Device', entityId: job.deviceId, metadata: { jobId: job.id, credentialId: job.credential!.id, snapshotId: snapshot.id, interfaceCount: result.interfaces.length } } }),
        ]);
        return snapshot;
      } catch (error) {
        const code = publicErrorCode(error);
        await this.prisma.$transaction([
          this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'FAILED', completedAt: new Date(), errorCode: code } }),
          this.prisma.snmpDeviceConfig.update({ where: { id: config.id }, data: { lastPollAt: new Date(), lastStatus: 'FAILED', lastErrorCode: code, consecutiveFailures: { increment: 1 } } }),
          this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_POLL_FAILED', entityType: 'Device', entityId: job.deviceId, metadata: { jobId: job.id, credentialId: job.credential!.id, errorCode: code } } }),
        ]);
        log('warn', 'poll failed', { jobId: job.id, deviceId: job.deviceId, errorCode: code });
        throw error;
      } finally { session?.close(); }
    });
  }

  /**
   * SNMP Phase 2 step 8: health (inventory, CPU, memory, errors, environment, stack, reboot) after the standard poll.
   * Best effort: a device without these MIBs, or a failed walk, never fails the standard poll; the last good reading
   * stays in place. Returns the stored status, or null when nothing was stored.
   */
  private async storeHealth(deviceId: string, jobId: string, session: Parameters<typeof pollDeviceHealth>[0], system: Awaited<ReturnType<typeof pollStandard>>['system']): Promise<string | null> {
    try {
      const snapshot = await pollDeviceHealth(session, system);
      const previous = await this.prisma.snmpDeviceHealth.findUnique({ where: { deviceId }, select: { uptimeTicks: true, observedAt: true, rebootDetectedAt: true, rebootCount: true } });
      const record = healthRecord(previous, snapshot, jobId);
      const data = { ...record, data: record.data as unknown as Prisma.InputJsonValue };
      await this.prisma.snmpDeviceHealth.upsert({ where: { deviceId }, create: { deviceId, ...data }, update: data });
      if (record.rebootDetectedAt && record.rebootDetectedAt.getTime() === record.observedAt.getTime()) log('warn', 'device reboot detected', { deviceId, jobId, bootedAt: record.bootedAt?.toISOString() ?? null });
      return record.status;
    } catch (error) {
      log('warn', 'health poll failed', { deviceId, jobId, errorCode: publicErrorCode(error) });
      return null;
    }
  }

  private async storeLldpObservations(deviceId: string, snapshotId: string, siteId: string | null, entries: Awaited<ReturnType<typeof pollLldp>>, interfaces: any[]) {
    for (const entry of entries) {
      const localPortDescription = interfaces.find((item) => item.name === entry.localPortId || item.portKey === entry.localPortId)?.name ?? null;
      const matches = entry.managementAddress && siteId ? await this.prisma.device.findMany({ where: { siteId, managementIp: entry.managementAddress }, select: { id: true } }) : [];
      const resolvedDeviceId = matches.length === 1 ? matches[0].id : null;
      const observedAt = new Date();
      const observation = await this.prisma.lldpObservation.create({ data: { deviceId, snapshotId, observedAt, confidence: resolvedDeviceId ? 95 : entry.managementAddress ? 50 : 25, localPortNumber: entry.localPortNumber, localPortId: entry.localPortId ?? null, localPortDescription, remoteChassisIdSubtype: entry.chassisSubtype ?? null, remoteChassisId: entry.chassisId ?? null, remotePortIdSubtype: entry.portSubtype ?? null, remotePortId: entry.portId ?? null, remotePortDescription: entry.portDescription ?? null, remoteSystemName: entry.systemName ?? null, managementAddress: entry.managementAddress ?? null, resolvedDeviceId, rawIdentifiers: entry.rawIdentifiers as Prisma.InputJsonValue } });
      if (!resolvedDeviceId || !siteId || !localPortDescription || !entry.portId) continue;
      const remotePorts = await this.prisma.deviceInterface.findMany({ where: { deviceId: resolvedDeviceId, OR: [{ name: entry.portId }, { portKey: entry.portId }] }, select: { id: true } });
      const localPorts = await this.prisma.deviceInterface.findMany({ where: { deviceId, OR: [{ name: localPortDescription }, { portKey: entry.localPortId ?? '' }] }, select: { id: true } });
      if (remotePorts.length !== 1 || localPorts.length !== 1 || remotePorts[0].id === localPorts[0].id) continue;
      const [sourceDeviceId, targetDeviceId] = [deviceId, resolvedDeviceId].sort();
      const sourceInterfaceId = sourceDeviceId === deviceId ? localPorts[0].id : remotePorts[0].id;
      const targetInterfaceId = targetDeviceId === resolvedDeviceId ? remotePorts[0].id : localPorts[0].id;
      const betweenEndpoints = await this.prisma.deviceConnection.findMany({ where: { siteId, OR: [{ sourceDeviceId, targetDeviceId }, { sourceDeviceId: targetDeviceId, targetDeviceId: sourceDeviceId }] }, select: { id: true, sourceDeviceId: true, targetDeviceId: true, sourceInterfaceId: true, targetInterfaceId: true, label: true, type: true } });
      if (betweenEndpoints.length > 1) continue;
      const existing = betweenEndpoints[0];
      const reversed = Boolean(existing && existing.sourceDeviceId === targetDeviceId);
      const desiredSourceInterfaceId = reversed ? targetInterfaceId : sourceInterfaceId;
      const desiredTargetInterfaceId = reversed ? sourceInterfaceId : targetInterfaceId;
      const desiredSourceDeviceId = existing?.sourceDeviceId ?? sourceDeviceId;
      const desiredTargetDeviceId = existing?.targetDeviceId ?? targetDeviceId;
      if (existing && existing.sourceInterfaceId === desiredSourceInterfaceId && existing.targetInterfaceId === desiredTargetInterfaceId) continue;
      const action = existing ? 'CONNECTION_UPDATE' : 'CONNECTION_ADD';
      const proposalKey = `${action}:${desiredSourceDeviceId}:${desiredSourceInterfaceId}:${desiredTargetDeviceId}:${desiredTargetInterfaceId}`;
      await this.createPendingProposals([{ deviceId, snapshotId, action, proposalKey, connectionId: existing?.id, confidence: 95, context: { observationId: observation.id, siteId }, beforeValues: existing ? { sourceInterfaceId: existing.sourceInterfaceId, targetInterfaceId: existing.targetInterfaceId, label: existing.label, type: existing.type } : undefined, observedValues: { siteId, sourceDeviceId: desiredSourceDeviceId, targetDeviceId: desiredTargetDeviceId, sourceInterfaceId: desiredSourceInterfaceId, targetInterfaceId: desiredTargetInterfaceId, type: existing?.type ?? 'PHYSICAL', label: existing?.label ?? (entry.portDescription ?? null) } }]);
    }
  }

  private async createTopologyProposals(deviceId: string, snapshotId: string, observed: Awaited<ReturnType<typeof pollStandard>>['interfaces'], documented: any[], siteId: string | null) {
    const names = new Map<string, any>();
    for (const item of documented) for (const key of [item.name, item.portKey].filter(Boolean)) names.set(String(key).toLowerCase(), item);
    const matched = new Set<string>();
    const proposals: any[] = [];
    const fields = ['description', 'macAddress', 'adminUp', 'operUp', 'speedMbps'] as const;
    for (const item of observed) {
      const current = (item.name && names.get(item.name.toLowerCase())) || (item.description && names.get(item.description.toLowerCase()));
      const incoming = Object.fromEntries(fields.filter((field) => item[field] !== undefined && item[field] !== null).map((field) => [field, item[field]]));
      const context = { siteId, observedName: item.name ?? null, observedDescription: item.description ?? null, observedAlias: item.alias ?? null, interfaceIndex: item.ifIndex };
      if (!current) {
        const name = item.name?.trim() || item.description?.trim() || `ifIndex-${item.ifIndex}`;
        proposals.push({ deviceId, snapshotId, action: 'ADD', proposalKey: `ADD:${item.ifIndex}`, observedIfIndex: item.ifIndex, confidence: item.name ? 80 : 60, context, observedValues: { name, portKey: item.name ?? null, ...incoming } });
        continue;
      }
      matched.add(current.id);
      const before = { ...Object.fromEntries(fields.filter((field) => current[field] !== undefined).map((field) => [field, current[field]])), lastSeenAt: current.lastSeenAt };
      const changed = Object.fromEntries(Object.entries(incoming).filter(([field, value]) => current[field] !== value));
      if (Object.keys(changed).length) proposals.push({ deviceId, snapshotId, interfaceId: current.id, action: 'UPDATE', proposalKey: `UPDATE:${current.id}`, observedIfIndex: item.ifIndex, confidence: 95, context: { ...context, nativeVlanId: current.nativeVlanId, accessVlanId: current.accessVlanId, allowedVlanIds: current.allowedVlans.map((vlan: any) => vlan.vlanId) }, beforeValues: before, observedValues: changed });
    }
    // IF-MIB polling does not expose proof that the walk was complete, so absence is not evidence of removal.
    if (proposals.length) await this.createPendingProposals(proposals);
  }

  /** Keep one live proposal per device/action/key while retaining reviewed history. Serializable isolation
   * protects the pending read + insert against two snapshots racing for the same key. */
  private async createPendingProposals(proposals: any[]) {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.topologyProposal.findMany({
            where: { status: 'PENDING', OR: proposals.map(({ deviceId, action, proposalKey }) => ({ deviceId, action, proposalKey })) },
            select: { deviceId: true, action: true, proposalKey: true },
          });
          const pending = new Set(existing.map((item: any) => `${item.deviceId}:${item.action}:${item.proposalKey}`));
          const fresh = proposals.filter((item) => !pending.has(`${item.deviceId}:${item.action}:${item.proposalKey}`));
          if (fresh.length) await tx.topologyProposal.createMany({ data: fresh as any, skipDuplicates: true });
        }, { isolationLevel: 'Serializable' });
        return;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2034') || attempt >= 2) throw error;
      }
    }
  }

  private async replaceDrifts(deviceId: string, snapshotId: string, device: { hostname: string | null }, result: Awaited<ReturnType<typeof pollStandard>>, byName: Map<string, any>) {
    const drifts: Array<{ deviceId: string; interfaceId?: string; snapshotId: string; field: string; documentedValue: any; observedValue: any }> = [];
    if (device.hostname && result.system.sysName && device.hostname !== result.system.sysName) drifts.push({ deviceId, snapshotId, field: 'hostname', documentedValue: device.hostname, observedValue: result.system.sysName });
    for (const observed of result.interfaces) {
      const documented = (observed.name && byName.get(observed.name.toLowerCase())) || (observed.description && byName.get(observed.description.toLowerCase()));
      if (!documented) continue;
      for (const field of ['description', 'adminUp', 'macAddress', 'speedMbps'] as const) {
        if (documented[field] !== null && observed[field] !== undefined && documented[field] !== observed[field]) drifts.push({ deviceId, interfaceId: documented.id, snapshotId, field, documentedValue: documented[field], observedValue: observed[field] });
      }
    }
    await this.prisma.$transaction([
      this.prisma.snmpDrift.deleteMany({ where: { deviceId, status: 'PENDING' } }),
      ...(drifts.length ? [this.prisma.snmpDrift.createMany({ data: drifts as any })] : []),
    ]);
  }
}

/** SNMP Phase 1 step 4.2: what the credential test shows inline: reachable, response time and the sysName it read. */
export function credentialTestResult(varbinds: Array<{ value?: unknown }>, startedAt: number, now = Date.now()) {
  const raw = varbinds[0]?.value;
  const sysName = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : null;
  return { reachable: true, durationMs: Math.max(0, now - startedAt), sysName: sysName && /^[\x20-\x7E]{1,255}$/.test(sysName) ? sysName : null };
}
