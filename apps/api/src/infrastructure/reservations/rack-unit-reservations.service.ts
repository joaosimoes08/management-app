import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure-access.service';
import { CreateRackUnitReservationDto } from './dto';
import { activeReservationWhere, spansOverlap } from './rack-unit-reservations';

const reservationSelect = {
  id: true, rackId: true, startUnit: true, size: true, reason: true, expiresAt: true, createdAt: true,
  createdBy: { select: { id: true, username: true, displayName: true } },
} as const;

/** Round 2 #18: U-space held in a rack for planned installs. Counted as used in the capacity outlook while active. */
@Injectable()
export class RackUnitReservationsService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService, private readonly audit: AuditService) {}

  async list(rackId: string, user: AuthenticatedUser, now = new Date()) {
    await this.access.assertRack(user, 'READ', rackId);
    return this.prisma.rackUnitReservation.findMany({ where: { rackId, ...activeReservationWhere(now) }, select: reservationSelect, orderBy: { startUnit: 'asc' } });
  }

  async create(rackId: string, dto: CreateRackUnitReservationDto, user: AuthenticatedUser, now = new Date()) {
    await this.access.assertRack(user, 'UPDATE', rackId);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= now.getTime()) throw new BadRequestException({ code: 'RACK_UNIT_RESERVATION_EXPIRED', message: 'A data de fim da reserva tem de ser futura.' });
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException({ code: 'RACK_UNIT_RESERVATION_REASON', message: 'Indica o motivo da reserva.' });
    const span = { startUnit: dto.startUnit, size: dto.size };
    return this.prisma.$transaction(async (tx) => {
      // Lock the rack row so two concurrent reservations cannot both take the same units.
      const [rack] = await tx.$queryRaw<{ units: number }[]>`SELECT "units" FROM "Rack" WHERE "id" = ${rackId}::uuid FOR UPDATE`;
      if (!rack) throw new NotFoundException('Bastidor não encontrado');
      if (span.startUnit + span.size - 1 > rack.units) throw new BadRequestException({ code: 'RACK_UNIT_RESERVATION_OUT_OF_RANGE', message: `A reserva tem de caber entre U1 e U${rack.units}.` });
      const devices = await tx.device.findMany({ where: { rackId, status: { not: 'RETIRED' }, rackUnitStart: { not: null }, rackUnitSize: { not: null } }, select: { id: true, name: true, rackUnitStart: true, rackUnitSize: true } });
      const device = devices.find((item) => spansOverlap(span, { startUnit: item.rackUnitStart!, size: item.rackUnitSize! }));
      if (device) throw new ConflictException({ code: 'RACK_UNITS_OCCUPIED', message: `As unidades já estão ocupadas por ${device.name}.` });
      const active = await tx.rackUnitReservation.findMany({ where: { rackId, ...activeReservationWhere(now) }, select: { id: true, startUnit: true, size: true, reason: true } });
      const clash = active.find((item) => spansOverlap(span, item));
      if (clash) throw new ConflictException({ code: 'RACK_UNIT_RESERVATION_OVERLAP', message: `As unidades já estão reservadas (${clash.reason}).` });
      const created = await tx.rackUnitReservation.create({ data: { rackId, startUnit: span.startUnit, size: span.size, reason, expiresAt, createdById: user.id }, select: reservationSelect });
      await this.audit.recordInTransaction(tx, { userId: user.id, action: 'RACK_UNITS_RESERVED', entityType: 'Rack', entityId: rackId, metadata: { reservationId: created.id, startUnit: span.startUnit, size: span.size, reason, expiresAt: expiresAt?.toISOString() ?? null } });
      return created;
    });
  }

  async release(rackId: string, reservationId: string, user: AuthenticatedUser, now = new Date()) {
    await this.access.assertRack(user, 'UPDATE', rackId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.rackUnitReservation.updateMany({ where: { id: reservationId, rackId, releasedAt: null }, data: { releasedAt: now, releasedById: user.id } });
      const reservation = await tx.rackUnitReservation.findFirst({ where: { id: reservationId, rackId }, select: { id: true, startUnit: true, size: true, reason: true, releasedAt: true } });
      if (!reservation) throw new NotFoundException('Reserva não encontrada');
      // Releasing twice is harmless: the first release stands and no second audit entry is written.
      if (updated.count === 1) await this.audit.recordInTransaction(tx, { userId: user.id, action: 'RACK_UNIT_RESERVATION_RELEASED', entityType: 'Rack', entityId: rackId, metadata: { reservationId, startUnit: reservation.startUnit, size: reservation.size, reason: reservation.reason } });
      return { id: reservation.id, releasedAt: reservation.releasedAt };
    });
  }
}
