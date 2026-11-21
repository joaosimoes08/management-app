import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { errorBody } from '../common/bulk-result';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { IpamAccessService } from './ipam-access.service';
import { IpamService } from './ipam.service';
import { findFreeIpv4 } from './ipam-workflow-helpers';

/** A tracked IP row that the existing reservation rules allow to reserve: FREE, unlinked, no NAT, no active reservation. */
const reservableIpWhere = { state: 'FREE' as const, deviceId: null, interfaceId: null, hostId: null, natRules: { none: {} }, translatedNatRules: { none: {} }, reservations: { none: { status: 'ACTIVE' as const } } };

export const MAX_NEXT_FREE = 32;

/** Prisma P2002 (unique constraint failed). */
export function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class IpamWorkflowsService {
  constructor(private readonly prisma: PrismaClient, private readonly access: IpamAccessService, private readonly audit: AuditService, private readonly ipam: IpamService) {}

  private count(value: unknown, fallback: number) {
    const parsed = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_NEXT_FREE) throw new BadRequestException({ code: 'IP_COUNT_INVALID', message: `count deve estar entre 1 e ${MAX_NEXT_FREE}.` });
    return parsed;
  }

  private async candidates(subnetId: string, count: number, from?: string, to?: string) {
    const subnet = await this.prisma.subnet.findUnique({ where: { id: subnetId }, select: { id: true, cidr: true, gateway: true, version: true } });
    if (!subnet) throw new NotFoundException({ code: 'SUBNET_NOT_FOUND', message: 'Subnet não encontrada.' });
    const [blockedRows, freeRows] = await Promise.all([
      this.prisma.ipAddress.findMany({ where: { subnetId, NOT: reservableIpWhere }, select: { address: true } }),
      this.prisma.ipAddress.findMany({ where: { subnetId, ...reservableIpWhere }, select: { id: true, address: true } }),
    ]);
    const found = findFreeIpv4(subnet.cidr, subnet.gateway, new Set(blockedRows.map((row) => row.address)), count, from || undefined, to || undefined);
    const freeByAddress = new Map(freeRows.map((row) => [row.address, row.id]));
    return { subnet, supported: found.supported, items: found.addresses.map((address) => ({ address, ipAddressId: freeByAddress.get(address) ?? null, tracked: freeByAddress.has(address) })) };
  }

  /** GET subnets/:id/next-free — lowest free usable addresses (IPv4). Read-only. */
  async nextFree(user: AuthenticatedUser, subnetId: string, query: { count?: string; from?: string; to?: string }) {
    await this.access.assertSubnet(user, 'READ', subnetId);
    const count = this.count(query.count, 1);
    const result = await this.candidates(subnetId, count, query.from, query.to);
    return {
      subnetId,
      cidr: result.subnet.cidr,
      supported: result.supported,
      requested: count,
      items: result.items,
      exhausted: result.supported && result.items.length < count,
      ...(result.supported ? {} : { message: 'A procura do próximo IP livre só está disponível para subnets IPv4.' }),
    };
  }

  /**
   * POST subnets/:id/reserve-next — reserves the next `count` free addresses in one transaction, under the
   * same rules as POST ip-reservations (duration 1..720 h, reason ≤500). Untracked addresses are created
   * as RESERVED IP rows, which needs CREATE on the subnet. All-or-nothing.
   */
  async reserveNext(user: AuthenticatedUser, subnetId: string, dto: { count?: number; from?: string; to?: string; durationHours?: number; reason: string }) {
    const hours = dto.durationHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new BadRequestException({ code: 'IP_RESERVATION_DURATION_INVALID', message: 'A duração tem de estar entre 1 hora e 30 dias.' });
    const reason = (dto.reason ?? '').trim();
    if (!reason || reason.length > 500) throw new BadRequestException({ code: 'IP_RESERVATION_REASON_INVALID', message: 'Indica um motivo até 500 caracteres.' });
    const count = this.count(dto.count, 1);
    await this.access.assertSubnet(user, 'UPDATE', subnetId);
    const result = await this.candidates(subnetId, count, dto.from, dto.to);
    if (!result.supported) throw new BadRequestException({ code: 'IP_RANGE_UNSUPPORTED', message: 'A reserva do próximo IP livre só está disponível para subnets IPv4.' });
    if (result.items.length < count) throw new ConflictException({ code: 'IP_RANGE_EXHAUSTED', message: `Só existem ${result.items.length} endereços livres no intervalo pedido.`, details: { available: result.items.length } });
    if (result.items.some((item) => !item.tracked)) await this.access.assertSubnet(user, 'CREATE', subnetId);
    const expiresAt = new Date(Date.now() + hours * 3_600_000);
    const changed = () => new ConflictException({ code: 'IP_RANGE_CHANGED', message: 'Um dos endereços deixou de estar livre. Volta a pedir o próximo IP livre.' });
    const reservations = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of result.items) {
        let ipAddressId = item.ipAddressId;
        if (ipAddressId) {
          const claimed = await tx.ipAddress.updateMany({ where: { id: ipAddressId, subnetId, ...reservableIpWhere }, data: { state: 'RESERVED' } });
          if (claimed.count !== 1) throw changed();
        } else {
          const row = await tx.ipAddress.create({ data: { address: item.address, subnetId, state: 'RESERVED', source: 'MANUAL', version: 4 }, select: { id: true } }).catch((error: unknown) => {
            // Only a unique violation (someone created this address meanwhile) means the range changed; anything else is a real error.
            if (isUniqueViolation(error)) throw changed();
            throw error;
          });
          ipAddressId = row.id;
        }
        const reservation = await tx.ipReservation.create({ data: { ipAddressId, createdById: user.id, reason, expiresAt } });
        await this.audit.recordInTransaction(tx, { userId: user.id, action: 'IP_RESERVATION_CREATED', entityType: 'IpReservation', entityId: reservation.id, metadata: { ipAddressId, address: item.address, reason, expiresAt, subnetId, createdIpAddress: !item.tracked, reserveNext: true } });
        created.push({ id: reservation.id, status: reservation.status, expiresAt: reservation.expiresAt, reason: reservation.reason, ipAddress: { id: ipAddressId, address: item.address }, createdIpAddress: !item.tracked });
      }
      return created;
    });
    return { subnetId, count: reservations.length, expiresAt, reservations };
  }

  /** POST discovery/results/bulk-review — per-item outcome; one failure does not undo the others. */
  async bulkReview(user: AuthenticatedUser, dto: { ids: string[]; status: string }) {
    const items = [];
    for (const id of dto.ids) {
      try {
        const result = await this.ipam.reviewResult(id, { status: dto.status }, user);
        items.push({ id, ok: true, status: result.status });
      } catch (error) {
        items.push({ id, ok: false, error: errorBody(error) });
      }
    }
    const succeeded = items.filter((item) => item.ok).length;
    return { status: dto.status, total: items.length, succeeded, failed: items.length - succeeded, items };
  }
}
