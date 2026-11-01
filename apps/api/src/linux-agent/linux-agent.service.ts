import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { EnrollLinuxAgentDto, LinuxHeartbeatDto } from './linux-agent.dto';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const STALE_AFTER_MS = 3 * 60_000;

@Injectable()
export class LinuxAgentService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService) {}

  async enroll(dto: EnrollLinuxAgentDto, user: AuthenticatedUser) {
    const host = await this.prisma.host.findUnique({ where: { id: dto.hostId }, include: { device: { select: { id: true } } } });
    if (!host) throw new NotFoundException('Host não encontrado');
    if (!host.device) throw new ForbiddenException('O host tem de estar associado a um equipamento com scope de acesso.');
    await this.access.assertDevice(user, 'UPDATE', host.device.id);
    const token = randomBytes(32).toString('base64url');
    const agent = await this.prisma.linuxAgent.upsert({ where: { hostId: host.id }, create: { hostId: host.id, tokenHash: hash(token) }, update: { tokenHash: hash(token), enrolledAt: new Date(), revokedAt: null, lastHeartbeatAt: null } });
    await this.audit.record({ userId: user.id, action: 'LINUX_AGENT_ENROLLED', entityType: 'LinuxAgent', entityId: agent.id, metadata: { hostId: host.id } });
    return { id: agent.id, hostId: host.id, token, enrolledAt: agent.enrolledAt };
  }

  async revoke(id: string, user: AuthenticatedUser) {
    const agent = await this.prisma.linuxAgent.findUnique({ where: { id }, include: { host: { select: { deviceId: true } } } });
    if (!agent) throw new NotFoundException('Agente não encontrado');
    if (!agent.host.deviceId) throw new ForbiddenException();
    await this.access.assertDevice(user, 'UPDATE', agent.host.deviceId);
    const updated = await this.prisma.linuxAgent.update({ where: { id }, data: { revokedAt: new Date(), tokenHash: hash(randomBytes(32).toString('base64url')) } });
    await this.audit.record({ userId: user.id, action: 'LINUX_AGENT_REVOKED', entityType: 'LinuxAgent', entityId: id });
    return { id, revokedAt: updated.revokedAt };
  }

  async list(user: AuthenticatedUser, siteId?: string) {
    const agents = await this.prisma.linuxAgent.findMany({ where: { host: { device: siteId ? { siteId } : { isNot: null } } }, include: { host: { include: { device: { select: { id: true, name: true, siteId: true } } } } }, orderBy: { host: { name: 'asc' } } });
    const visible = [];
    for (const item of agents) {
      if (!item.host.device) continue;
      try { await this.access.assertDevice(user, 'READ', item.host.device.id); } catch { continue; }
      visible.push({ id: item.id, hostId: item.hostId, hostName: item.host.name, deviceName: item.host.device.name, siteId: item.host.device.siteId, enrolledAt: item.enrolledAt, revokedAt: item.revokedAt, lastHeartbeatAt: item.lastHeartbeatAt, state: item.revokedAt ? 'REVOKED' : !item.lastHeartbeatAt ? 'PENDING' : Date.now() - item.lastHeartbeatAt.getTime() > STALE_AFTER_MS ? 'STALE' : 'ONLINE', hostname: item.observedHostname, os: item.observedOs, osVersion: item.observedOsVersion, agentVersion: item.agentVersion });
    }
    return visible;
  }

  async heartbeat(token: string | undefined, dto: LinuxHeartbeatDto) {
    if (!token || token.length > 200) throw new UnauthorizedException();
    const agent = await this.prisma.linuxAgent.findUnique({ where: { tokenHash: hash(token) } });
    if (!agent || agent.revokedAt) throw new UnauthorizedException('Agente não autorizado');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.linuxAgent.update({ where: { id: agent.id }, data: { lastHeartbeatAt: now, observedHostname: dto.hostname, observedOs: dto.os, observedOsVersion: dto.osVersion, agentVersion: dto.agentVersion } }),
      this.prisma.host.update({ where: { id: agent.hostId }, data: { observedHostname: dto.hostname, operatingSystem: `${dto.os} ${dto.osVersion}`.trim(), observedStatus: 'ONLINE', lastSeenAt: now, source: 'AGENT' } }),
    ]);
    return { accepted: true, receivedAt: now };
  }
}
