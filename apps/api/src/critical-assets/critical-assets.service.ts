import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { isIanaTimeZone } from '../common/time-zone';

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

/** Hour (Site-local, Monday) at which a weekly attestation cycle opens. */
export const ATTESTATION_OPENS_AT_HOUR = 9;

export function weeklyWindow(date: Date, timezone: string) {
  const local = localParts(date, timezone);
  const due = local.weekday === 'Mon' && Number(local.hour) >= ATTESTATION_OPENS_AT_HOUR;
  const localDate = new Date(`${local.year}-${local.month}-${local.day}T00:00:00.000Z`);
  localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() + 6) % 7));
  return { due, weekStart: localDate };
}


const DAY_MS = 86_400_000;

function timezoneOffsetMs(instant: Date, timezone: string) {
  const local = localParts(instant, timezone);
  const asUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute));
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** Converts a wall-clock time on a calendar date (given as a UTC-midnight Date) in `timezone` to the real instant. */
export function zonedWallClockToInstant(calendarDate: Date, hour: number, timezone: string) {
  const wallClock = Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth(), calendarDate.getUTCDate(), hour);
  let instant = wallClock - timezoneOffsetMs(new Date(wallClock), timezone);
  instant = wallClock - timezoneOffsetMs(new Date(instant), timezone);
  return new Date(instant);
}

/** A weekly cycle opens Monday 09:00 Site-local and is due when the next cycle opens (the following Monday 09:00). */
export function cycleWindow(weekStart: Date, timezone: string) {
  const nextWeekStart = new Date(weekStart.getTime() + 7 * DAY_MS);
  return { opensAt: zonedWallClockToInstant(weekStart, ATTESTATION_OPENS_AT_HOUR, timezone), dueAt: zonedWallClockToInstant(nextWeekStart, ATTESTATION_OPENS_AT_HOUR, timezone) };
}

export type DueState = 'overdue' | 'due_this_week' | 'up_to_date' | 'unscheduled';
type AttestationForDue = { weekStart: Date; outcome: string | null };

/**
 * Due state of one asset from its attestation rows.
 * - overdue: a cycle is still pending after its due time (dueDate = oldest overdue cycle's due time)
 * - due_this_week: the current cycle is pending and not yet due
 * - up_to_date: every generated cycle is recorded (dueDate = due time of the next cycle to be generated)
 * - unscheduled: no owner group (always, even with pending rows: nobody can review them; counts are kept),
 *   or no cycle generated yet (dueDate = next cycle's due time if owned, else null)
 */
export function computeDueState(attestations: AttestationForDue[], owned: boolean, timezone: string, now = new Date()) {
  const pending = attestations.filter((row) => !row.outcome).map((row) => ({ row, ...cycleWindow(row.weekStart, timezone) })).sort((a, b) => a.row.weekStart.getTime() - b.row.weekStart.getTime());
  const overdue = pending.filter((item) => item.dueAt.getTime() <= now.getTime());
  const base = { pendingCount: pending.length, overdueCount: overdue.length };
  // No owner group means nobody can review it: report it under "no owner", not as overdue or due.
  if (!owned) return { ...base, dueState: 'unscheduled' as DueState, dueDate: null, dueWeekStart: null };
  if (overdue.length) return { ...base, dueState: 'overdue' as DueState, dueDate: overdue[0].dueAt.toISOString(), dueWeekStart: overdue[0].row.weekStart.toISOString().slice(0, 10) };
  if (pending.length) return { ...base, dueState: 'due_this_week' as DueState, dueDate: pending[0].dueAt.toISOString(), dueWeekStart: pending[0].row.weekStart.toISOString().slice(0, 10) };
  const current = weeklyWindow(now, timezone);
  const latestWeek = attestations.reduce<number | null>((max, row) => max === null || row.weekStart.getTime() > max ? row.weekStart.getTime() : max, null);
  // The scheduler generates a cycle only on Monday from 09:00 Site-local, so once Monday has passed without one, the next is next week's.
  const generationClosesAt = zonedWallClockToInstant(new Date(current.weekStart.getTime() + DAY_MS), 0, timezone);
  const currentGenerated = latestWeek !== null && latestWeek >= current.weekStart.getTime();
  const nextWeekStart = !currentGenerated && now.getTime() < generationClosesAt.getTime() ? current.weekStart : new Date(current.weekStart.getTime() + 7 * DAY_MS);
  const next = cycleWindow(nextWeekStart, timezone);
  if (latestWeek === null) return { ...base, dueState: 'unscheduled' as DueState, dueDate: next.dueAt.toISOString(), dueWeekStart: nextWeekStart.toISOString().slice(0, 10) };
  return { ...base, dueState: 'up_to_date' as DueState, dueDate: next.dueAt.toISOString(), dueWeekStart: nextWeekStart.toISOString().slice(0, 10) };
}

type ReviewerLookup = Map<string, { id: string; username: string; displayName: string | null }>;
function withReviewer<T extends { confirmedBy: string | null }>(row: T, reviewers: ReviewerLookup) {
  const reviewer = row.confirmedBy ? reviewers.get(row.confirmedBy) : undefined;
  return { ...row, confirmedByName: reviewer ? reviewer.displayName || reviewer.username : null, confirmedByUser: reviewer ? { id: reviewer.id, username: reviewer.username, displayName: reviewer.displayName } : null };
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
    const reviewers = await this.reviewerLookup(rows.map((row) => row.confirmedBy));
    const now = new Date();
    const decorate = (device: (typeof devices)[number]) => {
      const owner = mappingByType.get(device.type) ?? null;
      const history = rows.filter((row) => row.deviceId === device.id);
      const latest = history.find((row) => row.outcome) ?? null;
      return {
        ...device,
        assignedGroup: owner,
        owner,
        ...computeDueState(history, Boolean(owner), site.timezone, now),
        latestOutcome: latest?.outcome ?? null,
        latestConfirmedAt: latest?.confirmedAt ?? null,
        attestations: history.map((row) => withReviewer(row, reviewers)),
      };
    };
    const visible = devices.filter((device) => !groupIds || mapped.some((mapping) => mapping.assetType === device.type && groupIds.includes(mapping.groupId)));
    return { timezone: site.timezone, generatedAt: now.toISOString(), mappings: mapped, assets: visible.map(decorate), unassigned: devices.filter((device) => !mappingByType.has(device.type)).map(decorate) };
  }

  private async reviewerLookup(ids: Array<string | null>): Promise<ReviewerLookup> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, username: true, displayName: true } });
    return new Map(users.map((user) => [user.id, user]));
  }

  async setMapping(siteId: string, assetType: string, groupId: string, timezone: string, user: AuthenticatedUser) {
    if (!isIanaTimeZone(timezone)) throw new BadRequestException('Fuso horário inválido');
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
    if (attestation.outcome) throw this.alreadyRecorded(attestation, await this.reviewerLookup([attestation.confirmedBy]));
    const result = await this.prisma.$transaction(async (tx) => {
      // Guarded write: only a still-pending row is updated, so two concurrent reviews cannot both succeed.
      const updated = await tx.criticalAssetAttestation.updateMany({ where: { id, outcome: null }, data: { outcome, notes, confirmedAt: new Date(), confirmedBy: user.id } });
      if (!updated.count) return null;
      await tx.auditLog.create({ data: { userId: user.id, action: 'CRITICAL_ASSET_ATTESTATION_RECORDED', entityType: 'Device', entityId: attestation.deviceId, metadata: { outcome, notes, attestationId: id } } });
      return tx.criticalAssetAttestation.findUniqueOrThrow({ where: { id } });
    });
    if (!result) {
      const current = await this.prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id } });
      throw this.alreadyRecorded(current, await this.reviewerLookup([current.confirmedBy]));
    }
    const reviewers = await this.reviewerLookup([result.confirmedBy]);
    return { ...withReviewer(result, reviewers), inventoryChanged: false };
  }

  private alreadyRecorded(row: { id: string; weekStart: Date; outcome: string | null; confirmedAt: Date | null; confirmedBy: string | null }, reviewers: ReviewerLookup) {
    const reviewed = withReviewer(row, reviewers);
    const week = row.weekStart.toISOString().slice(0, 10);
    return new ConflictException({
      code: 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED',
      message: `A revisão da semana de ${week} já foi registada${reviewed.confirmedByName ? ` por ${reviewed.confirmedByName}` : ''}. Não é possível registar outra para o mesmo ciclo.`,
      details: { attestationId: row.id, weekStart: week, outcome: row.outcome, confirmedAt: row.confirmedAt?.toISOString() ?? null, confirmedBy: row.confirmedBy, confirmedByName: reviewed.confirmedByName },
    });
  }
}
