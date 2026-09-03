import { Prisma, PrismaClient } from '@simoes/database';
import { SNMP_JOB_NAMES } from '@simoes/snmp-core';
import { createSnmpSession, get, pollStandard } from './client';
import { DeviceLocks } from './locks';
import { log, publicErrorCode } from './log';

export class PollProcessor {
  constructor(private readonly prisma: PrismaClient, private readonly locks: DeviceLocks) {}

  async scheduled(configId: string) {
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { id: configId } });
    if (!config?.enabled) return;
    const credential = await this.prisma.snmpCredential.findUnique({ where: { deviceId_purpose: { deviceId: config.deviceId, purpose: 'READ' } } });
    if (!credential?.enabled) throw Object.assign(new Error('SNMP_READ_CREDENTIAL_REQUIRED'), { code: 'SNMP_READ_CREDENTIAL_REQUIRED' });
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
    await this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId: job.deviceId } });
    let session: ReturnType<typeof createSnmpSession> | undefined;
    try {
      session = createSnmpSession(job.device.managementIp, config?.port ?? 161, config?.timeoutMs ?? 5000, 0, job.credential as any);
      const values = await get(session, ['1.3.6.1.2.1.1.5.0']);
      await this.prisma.$transaction([
        this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), result: { reachable: true } } }),
        this.prisma.snmpCredential.update({ where: { id: job.credential.id }, data: { lastTestedAt: new Date(), lastTestStatus: 'COMPLETED', lastUsedAt: new Date() } }),
        this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_CREDENTIAL_TEST_COMPLETED', entityType: 'SnmpCredential', entityId: job.credential.id, metadata: { deviceId: job.deviceId, jobId: job.id } } }),
      ]);
      return { valueReceived: Boolean(values.length) };
    } catch (error) {
      const code = publicErrorCode(error);
      await this.prisma.$transaction([
        this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'FAILED', completedAt: new Date(), errorCode: code } }),
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
        const existingInterfaces = await this.prisma.deviceInterface.findMany({ where: { deviceId: job.deviceId } });
        const byName = new Map(existingInterfaces.flatMap((item) => [item.name, item.portKey].filter(Boolean).map((name) => [String(name).toLowerCase(), item] as const)));
        const snapshot = await this.prisma.snmpSnapshot.create({ data: { deviceId: job.deviceId, jobId: job.id, ...result.system, raw: result.raw as Prisma.InputJsonValue, interfaces: { create: result.interfaces.map((item) => ({ ...item, counters: item.counters as Prisma.InputJsonValue, deviceInterfaceId: (item.name && byName.get(item.name.toLowerCase())?.id) || (item.description && byName.get(item.description.toLowerCase())?.id) })) } } });
        await this.replaceDrifts(job.deviceId, snapshot.id, job.device, result, byName);
        const nextPollAt = new Date(Date.now() + config.intervalMinutes * 60 * 1000);
        await this.prisma.$transaction([
          this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), result: { snapshotId: snapshot.id, interfaceCount: result.interfaces.length } } }),
          this.prisma.snmpDeviceConfig.update({ where: { id: config.id }, data: { lastPollAt: new Date(), nextPollAt, lastStatus: 'COMPLETED', lastErrorCode: null } }),
          this.prisma.snmpCredential.update({ where: { id: job.credential!.id }, data: { lastUsedAt: new Date() } }),
          this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_POLL_COMPLETED', entityType: 'Device', entityId: job.deviceId, metadata: { jobId: job.id, credentialId: job.credential!.id, snapshotId: snapshot.id, interfaceCount: result.interfaces.length } } }),
        ]);
        return snapshot;
      } catch (error) {
        const code = publicErrorCode(error);
        await this.prisma.$transaction([
          this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'FAILED', completedAt: new Date(), errorCode: code } }),
          this.prisma.snmpDeviceConfig.update({ where: { id: config.id }, data: { lastPollAt: new Date(), lastStatus: 'FAILED', lastErrorCode: code } }),
          this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_POLL_FAILED', entityType: 'Device', entityId: job.deviceId, metadata: { jobId: job.id, credentialId: job.credential!.id, errorCode: code } } }),
        ]);
        log('warn', 'poll failed', { jobId: job.id, deviceId: job.deviceId, errorCode: code });
        throw error;
      } finally { session?.close(); }
    });
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
