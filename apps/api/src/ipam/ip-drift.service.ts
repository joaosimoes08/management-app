import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { IpamAccessService } from './ipam-access.service';
import { findMissingIps, MISSING_WINDOW_DAYS } from './ip-drift';

export type MarkFreeResult = { ipId: string; ok: boolean; code?: 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_MISSING' | 'IP_IN_USE' | 'IP_RESERVATION_ACTIVE' | 'CHANGED'; message?: string; address?: string };

/** Round 2 #14: "Desaparecidos" on the discovery page — OCCUPIED addresses that recent scans no longer see — and freeing them. */
@Injectable()
export class IpDriftService {
  constructor(private readonly prisma: PrismaClient, private readonly access: IpamAccessService, private readonly audit: AuditService) {}

  private async visibleSubnetIds(user: AuthenticatedUser, filters: { siteId?: string; subnetId?: string }) {
    const where = await this.access.whereFor(user, 'READ', 'subnet');
    const scoped = { ...(filters.siteId ? { siteId: filters.siteId } : {}), ...(filters.subnetId ? { id: filters.subnetId } : {}) };
    if (!Object.keys(where).length && !Object.keys(scoped).length) return null; // ADMIN, unfiltered: every subnet
    return (await this.prisma.subnet.findMany({ where: { AND: [where, scoped] }, select: { id: true } })).map(({ id }) => id);
  }

  async listMissing(user: AuthenticatedUser, filters: { siteId?: string; subnetId?: string } = {}) {
    const subnetIds = await this.visibleSubnetIds(user, filters);
    const rows = await findMissingIps(this.prisma, { subnetIds });
    return { windowDays: MISSING_WINDOW_DAYS, total: rows.length, items: rows };
  }

  /**
   * Frees each address only if it is still missing, still OCCUPIED, not linked to a device, interface, host or NAT rule,
   * and has no active reservation — checked again inside the update, so a concurrent change wins. One result per address.
   */
  async markFree(user: AuthenticatedUser, ipIds: string[]) {
    const stillMissing = new Map((await findMissingIps(this.prisma, { ipIds })).map((row) => [row.ipId, row]));
    const results: MarkFreeResult[] = [];
    for (const ipId of ipIds) {
      try {
        const ip = await this.access.assertIp(user, 'UPDATE', ipId);
        const missing = stillMissing.get(ipId);
        if (!missing) { results.push({ ipId, ok: false, code: 'NOT_MISSING', address: ip.address, message: 'O endereço já não está em falta (foi visto, alterado ou não está ocupado).' }); continue; }
        if (ip.deviceId || ip.interfaceId || ip.hostId || await this.prisma.natRule.count({ where: { OR: [{ sourceIpId: ipId }, { translatedIpId: ipId }] } })) {
          results.push({ ipId, ok: false, code: 'IP_IN_USE', address: ip.address, message: 'O endereço está associado a um equipamento, host ou regra NAT; remove a associação no IPAM primeiro.' }); continue;
        }
        if (await this.prisma.ipReservation.count({ where: { ipAddressId: ipId, status: 'ACTIVE' } })) {
          results.push({ ipId, ok: false, code: 'IP_RESERVATION_ACTIVE', address: ip.address, message: 'O endereço tem uma reserva ativa.' }); continue;
        }
        const freed = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.ipAddress.updateMany({
            where: { id: ipId, state: 'OCCUPIED', lastSeenAt: missing.lastSeenAt, deviceId: null, interfaceId: null, hostId: null, natRules: { none: {} }, translatedNatRules: { none: {} }, reservations: { none: { status: 'ACTIVE' } } },
            data: { state: 'FREE' },
          });
          if (updated.count !== 1) return false;
          await this.audit.recordInTransaction(tx, { userId: user.id, action: 'IP_ADDRESS_MARKED_FREE', entityType: 'IpAddress', entityId: ipId, metadata: { address: ip.address, subnetId: missing.subnetId, previousState: 'OCCUPIED', lastSeenAt: missing.lastSeenAt, lastScanAt: missing.lastScanAt, scanCount: missing.scanCount, reason: 'DISCOVERY_MISSING' } });
          return true;
        });
        results.push(freed ? { ipId, ok: true, address: ip.address } : { ipId, ok: false, code: 'CHANGED', address: ip.address, message: 'O endereço foi alterado entretanto; atualiza a lista.' });
      } catch (error) {
        if (error instanceof NotFoundException) results.push({ ipId, ok: false, code: 'NOT_FOUND', message: 'IP não encontrado.' });
        else if (error instanceof ForbiddenException) results.push({ ipId, ok: false, code: 'FORBIDDEN', message: 'Sem permissão para alterar este endereço.' });
        else throw error;
      }
    }
    const succeeded = results.filter((item) => item.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  }
}
