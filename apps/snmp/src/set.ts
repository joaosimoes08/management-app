import { PrismaClient } from '@simoes/database';
import { SNMP_OIDS, validateSetTemplate } from '@simoes/snmp-core';
import { createSnmpSession, get, setValues, setVarbinds } from './client';
import { DeviceLocks } from './locks';
import { publicErrorCode } from './log';

function valueOf(varbind: any) { return Buffer.isBuffer(varbind?.value) ? varbind.value.toString('utf8') : varbind?.value; }
export function setVerificationMatches(expected: Array<{ oid: string; value: unknown }>, verified: Record<string, unknown>) {
  return expected.every((item) => String(verified[item.oid]) === String(item.value));
}

export class SetProcessor {
  constructor(private readonly prisma: PrismaClient, private readonly locks: DeviceLocks) {}

  async run(jobId: string) {
    const job = await this.prisma.snmpJob.findUnique({ where: { id: jobId }, include: { device: true, credential: true, writeRequest: true } });
    if (!job?.credential || !job.writeRequest || !job.device.managementIp) throw new Error('SNMP_SET_JOB_INVALID');
    const request = job.writeRequest;
    if (process.env.SNMP_SET_ENABLED !== 'true') {
      await this.prisma.$transaction([
        this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_SET_DISABLED' } }),
        this.prisma.snmpWriteRequest.update({ where: { id: request.id }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_SET_DISABLED' } }),
      ]);
      return;
    }
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId: job.deviceId } });
    if (!config?.enabled || job.credential.purpose !== 'WRITE') {
      await this.prisma.$transaction([
        this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_SET_CONFIGURATION_INVALID' } }),
        this.prisma.snmpWriteRequest.update({ where: { id: request.id }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_SET_CONFIGURATION_INVALID' } }),
      ]);
      return;
    }
    return this.locks.withLock(job.deviceId, Math.max(60_000, config.timeoutMs * 6), async () => {
      await this.prisma.$transaction([
        this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } }),
        this.prisma.snmpWriteRequest.update({ where: { id: request.id }, data: { status: 'RUNNING', startedAt: new Date() } }),
      ]);
      let session: ReturnType<typeof createSnmpSession> | undefined;
      try {
        session = createSnmpSession(job.device.managementIp!, config.port, config.timeoutMs, 0, job.credential as any);
        const template = validateSetTemplate(request.parameters);
        let ifIndex: number | undefined;
        let verificationOids: string[];
        if (template.operation === 'INTERFACE_ADMIN_STATUS') {
          const observation = await this.prisma.snmpInterfaceObservation.findFirst({
            where: { deviceInterfaceId: template.interfaceId, snapshot: { deviceId: job.deviceId } },
            orderBy: { snapshot: { observedAt: 'desc' } },
          });
          if (!observation) throw Object.assign(new Error('SNMP_INTERFACE_INDEX_UNAVAILABLE'), { code: 'SNMP_INTERFACE_INDEX_UNAVAILABLE' });
          ifIndex = observation.ifIndex;
          const ifNameOid = `1.3.6.1.2.1.31.1.1.1.1.${ifIndex}`;
          const identity = await get(session, [ifNameOid]);
          if (observation.name && String(valueOf(identity[0])) !== observation.name) throw Object.assign(new Error('SNMP_INTERFACE_IDENTITY_CHANGED'), { code: 'SNMP_INTERFACE_IDENTITY_CHANGED' });
          verificationOids = [`${SNMP_OIDS.ifAdminStatus}.${ifIndex}`];
        } else verificationOids = [...(template.sysName ? [SNMP_OIDS.sysName] : []), ...(template.sysLocation ? [SNMP_OIDS.sysLocation] : [])];
        const before = Object.fromEntries((await get(session, verificationOids)).map((item) => [item.oid, valueOf(item)]));
        await this.prisma.snmpWriteRequest.update({ where: { id: request.id }, data: { beforeValues: before } });
        await setValues(session, setVarbinds(template, ifIndex));
        const verified = Object.fromEntries((await get(session, verificationOids)).map((item) => [item.oid, valueOf(item)]));
        const expected = setVarbinds(template, ifIndex);
        if (!setVerificationMatches(expected, verified)) throw Object.assign(new Error('SNMP_SET_VERIFICATION_MISMATCH'), { code: 'SNMP_SET_VERIFICATION_MISMATCH' });
        await this.prisma.$transaction([
          this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), result: { verified: true } } }),
          this.prisma.snmpWriteRequest.update({ where: { id: request.id }, data: { status: 'COMPLETED', completedAt: new Date(), beforeValues: before, verifiedValues: verified } }),
          this.prisma.snmpCredential.update({ where: { id: job.credential!.id }, data: { lastUsedAt: new Date() } }),
          this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_SET_COMPLETED', entityType: 'SnmpWriteRequest', entityId: request.id, metadata: { deviceId: job.deviceId, credentialId: job.credential!.id, operation: request.operation, jobId: job.id } } }),
        ]);
      } catch (error) {
        const code = publicErrorCode(error);
        const uncertain = code === 'SNMP_TIMEOUT' || code === 'SNMP_SET_VERIFICATION_MISMATCH';
        await this.prisma.$transaction([
          this.prisma.snmpJob.update({ where: { id: job.id }, data: { status: 'FAILED', completedAt: new Date(), errorCode: code } }),
          this.prisma.snmpWriteRequest.update({ where: { id: request.id }, data: { status: uncertain ? 'NEEDS_ATTENTION' : 'FAILED', completedAt: new Date(), errorCode: code } }),
          this.prisma.auditLog.create({ data: { userId: job.requestedBy, action: 'SNMP_SET_FAILED', entityType: 'SnmpWriteRequest', entityId: request.id, metadata: { deviceId: job.deviceId, credentialId: job.credential!.id, operation: request.operation, jobId: job.id, errorCode: code, uncertain } } }),
        ]);
        throw error;
      } finally { session?.close(); }
    });
  }
}
