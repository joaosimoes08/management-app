import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function weeklyWindow(date: Date, timezone: string) {
  const local = localParts(date, timezone);
  const due = local.weekday === 'Mon' && Number(local.hour) >= 9;
  const localDate = new Date(`${local.year}-${local.month}-${local.day}T00:00:00.000Z`);
  localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() + 6) % 7));
  return { due, weekStart: localDate };
}

@Injectable()
export class CriticalAssetsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CriticalAssetsService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService) {}

  onModuleInit() { this.timer = setInterval(() => void this.runWeeklyChecks().catch((error) => this.logger.error('Weekly critical asset checks failed', error instanceof Error ? error.stack : String(error))), 60_000); this.timer.unref(); void this.runWeeklyChecks().catch((error) => this.logger.error('Weekly critical asset checks failed', error instanceof Error ? error.stack : String(error))); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runWeeklyChecks(now = new Date()) {
    const sites = await this.prisma.site.findMany({ select: { id: true, name: true, timezone: true } });
    for (const site of sites) {
      let window;
      try { window = weeklyWindow(now, site.timezone); } catch { continue; }
      if (!window.due) continue;
      const weekStart = window.weekStart;
      try {
        const devices = await this.prisma.device.findMany({ where: { siteId: site.id, isCritical: true, status: { not: 'RETIRED' } }, select: { id: true, name: true, type: true } });
        for (const device of devices) {
          try {
            await this.prisma.$transaction(async (tx) => {
              const mapping = await tx.criticalAssetGroupMapping.findUnique({ where: { siteId_assetType: { siteId: site.id, assetType: device.type } }, include: { group: { include: { members: { select: { userId: true } } } } } });
              if (!mapping) return;
              const created = await tx.criticalAssetAttestation.createMany({ data: [{ siteId: site.id, deviceId: device.id, weekStart }], skipDuplicates: true });
              if (!created.count) return;
              if (mapping.group.members.length) await tx.notification.createMany({ data: mapping.group.members.map(({ userId }) => ({ userId, type: 'CRITICAL_ASSET_ATTESTATION', title: 'Revisão semanal de ativo crítico', message: `${site.name}: confirma nome, tipo, hostname, IP de gestão, número de série, etiqueta e estado de ${device.name}.` })) });
            });
          } catch (error) {
            this.logger.error(`Weekly attestation failed for device ${device.id} at site ${site.id}`, error instanceof Error ? error.stack : String(error));
          }
        }
      } catch (error) {
        this.logger.error(`Weekly critical asset checks failed for site ${site.id}`, error instanceof Error ? error.stack : String(error));
      }
    }
  }

  async list(siteId: string, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'READ', siteId, 'DEVICE');
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { timezone: true } });
    const devices = await this.prisma.device.findMany({ where: { isCritical: true, siteId }, select: { id: true, name: true, type: true, hostname: true, managementIp: true, serialNumber: true, assetTag: true, status: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    const mapped = await this.prisma.criticalAssetGroupMapping.findMany({ where: { siteId }, include: { group: { select: { id: true, name: true } } } });
    const mappingByType = new Map(mapped.map((mapping) => [mapping.assetType, mapping.group]));
    const groupIds = user.roles.includes('ADMIN') ? null : (await this.prisma.accessGroupMember.findMany({ where: { userId: user.id }, select: { groupId: true } })).map((item) => item.groupId);
    const rows = await this.prisma.criticalAssetAttestation.findMany({ where: { siteId, deviceId: { in: devices.map(({ id }) => id) } }, orderBy: { weekStart: 'desc' } });
    return { timezone: site.timezone, mappings: mapped, assets: devices.filter((device) => !groupIds || mapped.some((mapping) => mapping.assetType === device.type && groupIds.includes(mapping.groupId))).map((device) => ({ ...device, assignedGroup: mappingByType.get(device.type) ?? null, attestations: rows.filter((row) => row.deviceId === device.id) })), unassigned: devices.filter((device) => !mappingByType.has(device.type)) };
  }

  async setMapping(siteId: string, assetType: string, groupId: string, timezone: string, user: AuthenticatedUser) {
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new BadRequestException('Fuso horário inválido'); }
    await this.access.assertSite(user, 'UPDATE', siteId, 'DEVICE', assetType);
    const result = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.accessGroupSite.findUnique({ where: { groupId_siteId: { groupId, siteId } }, select: { groupId: true } });
      if (!assignment) throw new BadRequestException({ code: 'CRITICAL_ASSET_GROUP_SITE_MISMATCH', message: 'O grupo não está associado a este Site.' });
      const mapping = await tx.criticalAssetGroupMapping.upsert({ where: { siteId_assetType: { siteId, assetType } }, create: { siteId, assetType, groupId }, update: { groupId } });
      await tx.site.update({ where: { id: siteId }, data: { timezone } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'CRITICAL_ASSET_GROUP_MAPPING_UPDATED', entityType: 'Site', entityId: siteId, metadata: { assetType, groupId, timezone } } });
      return mapping;
    });
    return result;
  }

  async confirm(id: string, outcome: string, notes: string | undefined, user: AuthenticatedUser) {
    if (!['CONFIRMED', 'CORRECTION_NEEDED'].includes(outcome)) throw new BadRequestException('Resultado inválido');
    const attestation = await this.prisma.criticalAssetAttestation.findUnique({ where: { id }, include: { device: true } });
    if (!attestation) throw new BadRequestException('Attestation não encontrada');
    await this.access.assertSite(user, 'READ', attestation.siteId, 'DEVICE', attestation.device.type);
    const mapping = await this.prisma.criticalAssetGroupMapping.findUnique({ where: { siteId_assetType: { siteId: attestation.siteId, assetType: attestation.device.type } }, include: { group: { include: { members: { where: { userId: user.id } } } } } });
    if (!user.roles.includes('ADMIN') && !mapping?.group.members.length) throw new ForbiddenException('Não tens acesso a esta revisão');
    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.criticalAssetAttestation.update({ where: { id }, data: { outcome, notes, confirmedAt: new Date(), confirmedBy: user.id } });
      await tx.auditLog.create({ data: { userId: user.id, action: 'CRITICAL_ASSET_ATTESTATION_RECORDED', entityType: 'Device', entityId: attestation.deviceId, metadata: { outcome, notes, attestationId: id } } });
      return saved;
    });
    return { ...result, inventoryChanged: false };
  }
}
