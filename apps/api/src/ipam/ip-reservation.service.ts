import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { IpamAccessService } from './ipam-access.service';

const safeIpWhere = { state: 'RESERVED' as const, deviceId: null, interfaceId: null, hostId: null, natRules: { none: {} }, translatedNatRules: { none: {} } };

@Injectable()
export class IpReservationService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer?: ReturnType<typeof setInterval>;
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: IpamAccessService) {}
  onModuleInit() { this.expiryTimer = setInterval(() => { void this.expireDue().catch(() => undefined); }, 60_000); this.expiryTimer.unref?.(); void this.expireDue().catch(() => undefined); }
  onModuleDestroy() { if (this.expiryTimer) clearInterval(this.expiryTimer); }

  async create(dto: { ipAddressId: string; durationHours?: number; reason: string }, user: AuthenticatedUser) {
    const hours = dto.durationHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new BadRequestException({ code: 'IP_RESERVATION_DURATION_INVALID', message: 'A duração tem de estar entre 1 hora e 30 dias.' });
    const reason = dto.reason.trim();
    if (!reason || reason.length > 500) throw new BadRequestException({ code: 'IP_RESERVATION_REASON_INVALID', message: 'Indica um motivo até 500 caracteres.' });
    const ip = await this.access.assertIp(user, 'UPDATE', dto.ipAddressId);
    if (ip.deviceId || ip.interfaceId || ip.hostId || ip.state !== 'FREE') throw new ConflictException({ code: 'IP_NOT_AVAILABLE', message: 'Este endereço IP já não está disponível.' });
    const expiresAt = new Date(Date.now() + hours * 3_600_000);
    return this.prisma.$transaction(async (tx) => {
        const claimed = await tx.ipAddress.updateMany({ where: { id: ip.id, state: 'FREE', deviceId: null, interfaceId: null, hostId: null, natRules: { none: {} }, translatedNatRules: { none: {} } }, data: { state: 'RESERVED' } });
        if (claimed.count !== 1) throw new ConflictException({ code: 'IP_NOT_AVAILABLE', message: 'Este endereço IP já não está disponível.' });
        const reservation = await tx.ipReservation.create({ data: { ipAddressId: ip.id, createdById: user.id, reason, expiresAt } });
        await this.audit.recordInTransaction(tx, { userId: user.id, action: 'IP_RESERVATION_CREATED', entityType: 'IpReservation', entityId: reservation.id, metadata: { ipAddressId: ip.id, address: ip.address, reason, expiresAt } });
        return { ...reservation, ipAddress: { id: ip.id, address: ip.address } };
    });
  }

  async release(id: string, user: AuthenticatedUser) {
    const current = await this.prisma.ipReservation.findUnique({ where: { id }, include: { ipAddress: true } });
    if (!current) throw new NotFoundException({ code: 'IP_RESERVATION_NOT_FOUND', message: 'Reserva não encontrada.' });
    await this.access.assertIp(user, 'UPDATE', current.ipAddressId);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.ipReservation.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
      if (!changed.count) throw new ConflictException({ code: 'IP_RESERVATION_INACTIVE', message: 'A reserva já expirou ou foi libertada.' });
      const free = await tx.ipAddress.updateMany({ where: { id: current.ipAddressId, ...safeIpWhere }, data: { state: 'FREE' } });
      await this.audit.recordInTransaction(tx, { userId: user.id, action: 'IP_RESERVATION_RELEASED', entityType: 'IpReservation', entityId: id, metadata: { ipAddressId: current.ipAddressId, address: current.ipAddress.address, restoredToFree: free.count === 1 } });
      return { success: true, released: true };
    });
  }

  async expireDue(now = new Date()) {
    const due = await this.prisma.ipReservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, select: { id: true, ipAddressId: true }, take: 500, orderBy: { expiresAt: 'asc' } });
    let expired = 0;
    for (const item of due) {
      const didExpire = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.ipReservation.updateMany({ where: { id: item.id, status: 'ACTIVE', expiresAt: { lte: now } }, data: { status: 'EXPIRED', releasedAt: now } });
        if (!changed.count) return false;
        await tx.ipAddress.updateMany({ where: { id: item.ipAddressId, ...safeIpWhere }, data: { state: 'FREE' } });
        await this.audit.recordInTransaction(tx, { action: 'IP_RESERVATION_EXPIRED', entityType: 'IpReservation', entityId: item.id, metadata: { ipAddressId: item.ipAddressId } });
        return true;
      });
      if (didExpire) expired++;
    }
    return expired;
  }
}
