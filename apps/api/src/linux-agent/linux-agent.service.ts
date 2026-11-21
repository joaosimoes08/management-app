import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { EnrollLinuxAgentDto, LinuxHeartbeatDto } from './linux-agent.dto';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export function linuxAgentStaleMinutes(value = process.env.LINUX_AGENT_STALE_MINUTES) {
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 15;
}

export function linuxAgentState(revokedAt: Date | null, lastHeartbeatAt: Date | null, now = Date.now(), staleMinutes = linuxAgentStaleMinutes(), enrolledAt?: Date) {
  if (revokedAt) return 'REVOKED';
  const lastContact = lastHeartbeatAt ?? enrolledAt;
  if (lastContact && now - lastContact.getTime() >= staleMinutes * 60_000) return 'STALE';
  return lastHeartbeatAt ? 'ONLINE' : 'PENDING';
}

@Injectable()
export class LinuxAgentService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService, private readonly ipamAccess: IpamAccessService) {}

  async enroll(dto: EnrollLinuxAgentDto, user: AuthenticatedUser) {
    const host = await this.prisma.host.findUnique({ where: { id: dto.hostId }, include: { device: { select: { id: true } } } });
    if (!host) throw new NotFoundException('Host não encontrado');
    if (!host.device) throw new ForbiddenException('O host tem de estar associado a um equipamento com scope de acesso.');
    await this.access.assertDevice(user, 'UPDATE', host.device.id);
    const token = randomBytes(32).toString('base64url');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.linuxAgent.findUnique({ where: { hostId: host.id } });
        if (existing) {
          const updated = await tx.linuxAgent.updateMany({
            where: { id: existing.id, revokedAt: { not: null } },
            data: { tokenHash: hash(token), enrolledAt: new Date(), revokedAt: null, lastHeartbeatAt: null, observedHostname: null, observedOs: null, observedOsVersion: null, agentVersion: null },
          });
          if (!updated.count) return { hostId: host.id, tokenAlreadyIssued: true };
        }
        const agent = existing
          ? await tx.linuxAgent.findUniqueOrThrow({ where: { id: existing.id } })
          : await tx.linuxAgent.create({ data: { hostId: host.id, tokenHash: hash(token) } });
        await this.audit.recordInTransaction(tx, { userId: user.id, action: 'LINUX_AGENT_ENROLLED', entityType: 'LinuxAgent', entityId: agent.id, metadata: { hostId: host.id } });
        return { id: agent.id, hostId: host.id, token, enrolledAt: agent.enrolledAt };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
          && Array.isArray(error.meta?.target) && error.meta.target.includes('hostId')) {
        return { hostId: host.id, tokenAlreadyIssued: true };
      }
      throw error;
    }
  }

  async revoke(id: string, user: AuthenticatedUser) {
    const agent = await this.prisma.linuxAgent.findUnique({ where: { id }, include: { host: { select: { deviceId: true } } } });
    if (!agent) throw new NotFoundException('Agente não encontrado');
    if (agent.host.deviceId) await this.access.assertDevice(user, 'UPDATE', agent.host.deviceId);
    else if (!user.roles.includes('ADMIN')) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const revokedAt = new Date();
      const updated = await tx.linuxAgent.updateMany({
        where: { id, tokenHash: agent.tokenHash, revokedAt: null },
        data: { revokedAt, tokenHash: hash(randomBytes(32).toString('base64url')) },
      });
      if (!updated.count) {
        const current = await tx.linuxAgent.findUniqueOrThrow({ where: { id }, select: { revokedAt: true } });
        if (!current.revokedAt) throw new ConflictException('O token do agente mudou. Atualiza a lista antes de revogar.');
        return { id, revokedAt: current.revokedAt };
      }
      await this.audit.recordInTransaction(tx, { userId: user.id, action: 'LINUX_AGENT_REVOKED', entityType: 'LinuxAgent', entityId: id, metadata: { hostId: agent.hostId } });
      return { id, revokedAt };
    });
  }

  async list(user: AuthenticatedUser, siteId?: string) {
    const agents = await this.prisma.linuxAgent.findMany({ where: { host: { device: siteId ? { siteId } : { isNot: null } } }, include: { host: { include: { device: { select: { id: true, name: true, siteId: true } } } } }, orderBy: { host: { name: 'asc' } } });
    const visible = [];
    for (const item of agents) {
      if (!item.host.device) continue;
      try { await this.access.assertDevice(user, 'READ', item.host.device.id); } catch { continue; }
      visible.push({ id: item.id, hostId: item.hostId, hostName: item.host.name, deviceName: item.host.device.name, siteId: item.host.device.siteId, enrolledAt: item.enrolledAt, revokedAt: item.revokedAt, lastHeartbeatAt: item.lastHeartbeatAt, state: linuxAgentState(item.revokedAt, item.lastHeartbeatAt), hostname: item.observedHostname, os: item.observedOs, osVersion: item.observedOsVersion, agentVersion: item.agentVersion });
    }
    return visible;
  }

  private async inventoryScope(user: AuthenticatedUser, siteId?: string) {
    const admin = user.roles.includes('ADMIN');
    const ipScope: Prisma.IpAddressWhereInput = await this.ipamAccess.whereFor(user, 'READ', 'ip');
    const ipAtSite: Prisma.IpAddressWhereInput = siteId ? { AND: [ipScope, { subnet: { siteId } }] } : ipScope;
    const [rooms, unplacedSites] = admin ? [[], []] : await Promise.all([
      this.access.visibleRoomIds(user),
      this.access.visibleUnplacedSiteIds(user),
    ]);
    const deviceScope: Prisma.DeviceWhereInput = admin ? {} : {
      OR: [{ rack: { roomId: { in: rooms } } }, { rackId: null, siteId: { in: unplacedSites } }],
    };
    const deviceAtSite = { ...deviceScope, ...(siteId ? { siteId } : {}) };
    const where: Prisma.HostWhereInput = admin && !siteId ? {} : {
      OR: [{ device: { is: deviceAtSite } }, { ipAddresses: { some: ipAtSite } }],
    };
    return { where, deviceScope, ipScope };
  }

  async inventory(user: AuthenticatedUser, siteId?: string) {
    const { where, deviceScope, ipScope } = await this.inventoryScope(user, siteId);
    const hosts = await this.prisma.host.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, hostname: true, observedHostname: true, operatingSystem: true, deviceId: true,
        ipAddresses: {
          where: ipScope,
          orderBy: { address: 'asc' },
          select: { id: true, address: true, subnet: { select: { id: true, siteId: true } } },
        },
        linuxAgent: { select: { id: true, enrolledAt: true, revokedAt: true, lastHeartbeatAt: true, agentVersion: true } },
      },
    });
    const deviceIds = hosts.flatMap((host) => host.deviceId ? [host.deviceId] : []);
    const devices = deviceIds.length ? await this.prisma.device.findMany({
      where: { ...deviceScope, id: { in: deviceIds } },
      select: { id: true, name: true, siteId: true },
    }) : [];
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    const staleMinutes = linuxAgentStaleMinutes();
    const now = Date.now();
    return {
      staleMinutes,
      items: hosts.map(({ deviceId, linuxAgent, observedHostname, ...host }) => {
        const device = deviceId ? deviceById.get(deviceId) ?? null : null;
        const agent = linuxAgent && (device || user.roles.includes('ADMIN')) ? {
          ...linuxAgent,
          state: linuxAgentState(linuxAgent.revokedAt, linuxAgent.lastHeartbeatAt, now, staleMinutes, linuxAgent.enrolledAt),
        } : null;
        return { ...host, hostname: observedHostname || host.hostname, device, agent };
      }),
    };
  }

  async services(hostId: string, user: AuthenticatedUser) {
    const { where } = await this.inventoryScope(user);
    const host = await this.prisma.host.findFirst({
      where: { AND: [where, { id: hostId }] },
      select: { services: {
        orderBy: [{ port: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, protocol: true, port: true, version: true, observedStatus: true, lastSeenAt: true },
      } },
    });
    if (!host) throw new NotFoundException('Host não encontrado');
    return host.services;
  }

  async heartbeat(token: string | undefined, dto: LinuxHeartbeatDto) {
    if (!token || token.length > 200) throw new UnauthorizedException();
    const agent = await this.prisma.linuxAgent.findUnique({ where: { tokenHash: hash(token) } });
    if (!agent || agent.revokedAt) throw new UnauthorizedException('Agente não autorizado');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.linuxAgent.updateMany({
        where: { id: agent.id, tokenHash: agent.tokenHash, revokedAt: null },
        data: { lastHeartbeatAt: now, observedHostname: dto.hostname, observedOs: dto.os, observedOsVersion: dto.osVersion, agentVersion: dto.agentVersion },
      });
      if (!updated.count) throw new UnauthorizedException('Agente não autorizado');
      await tx.host.update({ where: { id: agent.hostId }, data: { observedHostname: dto.hostname, operatingSystem: `${dto.os} ${dto.osVersion}`.trim(), observedStatus: 'ONLINE', lastSeenAt: now, source: 'AGENT' } });
    });
    return { accepted: true, receivedAt: now };
  }
}
