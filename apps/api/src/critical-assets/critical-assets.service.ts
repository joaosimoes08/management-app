import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
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
const WEEK_MS = 7 * DAY_MS;
/** Monday 1970-01-05 (UTC midnight): the anchor for cadence periods. */
const FIRST_MONDAY_MS = Date.UTC(1970, 0, 5);

/** Index of the Monday (UTC-midnight weekStart) counted in weeks from the anchor. */
export function weekIndex(weekStart: Date) {
  return Math.round((weekStart.getTime() - FIRST_MONDAY_MS) / WEEK_MS);
}

/** A cadence of N weeks gets a cycle on every Monday whose week index is a multiple of N. */
export function isCycleWeek(weekStart: Date, periodWeeks: number) {
  return ((weekIndex(weekStart) % periodWeeks) + periodWeeks) % periodWeeks === 0;
}

/** First cycle Monday on or after `weekStart` for this cadence. */
export function nextCycleWeek(weekStart: Date, periodWeeks: number) {
  let candidate = new Date(weekStart);
  while (!isCycleWeek(candidate, periodWeeks)) candidate = new Date(candidate.getTime() + WEEK_MS);
  return candidate;
}

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
export function cycleWindow(weekStart: Date, timezone: string, periodWeeks = 1) {
  const nextWeekStart = new Date(weekStart.getTime() + periodWeeks * WEEK_MS);
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
export function computeDueState(attestations: AttestationForDue[], owned: boolean, timezone: string, now = new Date(), periodWeeks = 1) {
  const pending = attestations.filter((row) => !row.outcome).map((row) => ({ row, ...cycleWindow(row.weekStart, timezone, periodWeeks) })).sort((a, b) => a.row.weekStart.getTime() - b.row.weekStart.getTime());
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
  // Still open for generation this week: that cycle is the next one. Otherwise the cycle is the next cadence Monday after it.
  const thisWeekOpen = isCycleWeek(current.weekStart, periodWeeks) && !currentGenerated && now.getTime() < generationClosesAt.getTime();
  const nextWeekStart = nextCycleWeek(thisWeekOpen || !isCycleWeek(current.weekStart, periodWeeks) ? current.weekStart : new Date(current.weekStart.getTime() + WEEK_MS), periodWeeks);
  const next = cycleWindow(nextWeekStart, timezone, periodWeeks);
  if (latestWeek === null) return { ...base, dueState: 'unscheduled' as DueState, dueDate: next.dueAt.toISOString(), dueWeekStart: nextWeekStart.toISOString().slice(0, 10) };
  return { ...base, dueState: 'up_to_date' as DueState, dueDate: next.dueAt.toISOString(), dueWeekStart: nextWeekStart.toISOString().slice(0, 10) };
}

export type CadenceSite = { criticalCadenceT1Weeks: number; criticalCadenceT2Weeks: number; criticalCadenceT3Weeks: number };

/** Review cadence in weeks for a device's tier. A device without a tier falls back to T2. */
export function cadenceWeeks(tier: string | null | undefined, site: CadenceSite) {
  if (tier === 'T1') return site.criticalCadenceT1Weeks;
  if (tier === 'T3') return site.criticalCadenceT3Weeks;
  return site.criticalCadenceT2Weeks;
}

export const CRITICAL_ASSET_OUTCOMES = ['CONFIRMED', 'NEEDS_CORRECTION', 'NOT_FOUND'] as const;
export type CriticalAssetOutcomeValue = (typeof CRITICAL_ASSET_OUTCOMES)[number];
export const CORRECTION_STATUSES = ['OPEN', 'RESOLVED', 'REJECTED'] as const;
export const BULK_CONFIRM_LIMIT = 100;
export const MAX_PAGE_SIZE = 200;
/** Filter value meaning "no owner group" (owner) or "no review yet" (outcome). */
export const NO_FILTER_VALUE = 'NONE';

export function isCriticalAssetOutcome(value: unknown): value is CriticalAssetOutcomeValue {
  return typeof value === 'string' && (CRITICAL_ASSET_OUTCOMES as readonly string[]).includes(value);
}

export type AssetQuery = { type?: string; owner?: string; outcome?: string; due?: string; q?: string; page?: number; pageSize?: number };

type PageableAsset = { name: string; type: string; hostname: string | null; managementIp: string | null; serialNumber: string | null; assetTag: string | null; owner: { id: string } | null; latestOutcome: string | null; dueState: string };

/** Filters, then pages, the decorated asset rows. Filtering happens on the server so the page never loads every row. */
export function pageAssets<T extends PageableAsset>(assets: T[], query: AssetQuery) {
  const needle = (query.q ?? '').trim().toLowerCase();
  const filtered = assets.filter((asset) => {
    if (query.type && asset.type !== query.type) return false;
    if (query.owner === NO_FILTER_VALUE) { if (asset.owner) return false; }
    else if (query.owner && asset.owner?.id !== query.owner) return false;
    if (query.outcome === NO_FILTER_VALUE) { if (asset.latestOutcome) return false; }
    else if (query.outcome && asset.latestOutcome !== query.outcome) return false;
    if (query.due && asset.dueState !== query.due) return false;
    if (needle && ![asset.name, asset.hostname, asset.managementIp, asset.serialNumber, asset.assetTag].filter(Boolean).join(' ').toLowerCase().includes(needle)) return false;
    return true;
  });
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize ?? 50), 1), MAX_PAGE_SIZE);
  const page = Math.max(Math.floor(query.page ?? 1), 1);
  return { total: filtered.length, page, pageSize, items: filtered.slice((page - 1) * pageSize, page * pageSize) };
}

/** Counts for the summary strip, computed over the same rows the person may see. */
export function summarizeAssets(assets: Array<{ owner: unknown; dueState: string; latestOutcome: string | null }>) {
  return {
    total: assets.length,
    overdue: assets.filter((asset) => asset.dueState === 'overdue').length,
    dueThisWeek: assets.filter((asset) => asset.dueState === 'due_this_week').length,
    needsCorrection: assets.filter((asset) => asset.latestOutcome === 'NEEDS_CORRECTION').length,
    noOwner: assets.filter((asset) => !asset.owner).length,
  };
}

/** Outcome and notes rules shared by single and bulk review. A correction request needs the data to fix. */
export function validateReview(outcome: unknown, notes: unknown): { outcome: CriticalAssetOutcomeValue; notes?: string } {
  if (!isCriticalAssetOutcome(outcome)) throw new BadRequestException('Resultado inválido');
  const text = typeof notes === 'string' ? notes.trim() : '';
  if (outcome === 'NEEDS_CORRECTION' && !text) throw new BadRequestException('Indica os dados a corrigir.');
  return { outcome, notes: text || undefined };
}

type ReviewerLookup = Map<string, { id: string; username: string; displayName: string | null }>;
function withReviewer<T extends { confirmedBy: string | null }>(row: T, reviewers: ReviewerLookup) {
  const reviewer = row.confirmedBy ? reviewers.get(row.confirmedBy) : undefined;
  return { ...row, confirmedByName: reviewer ? reviewer.displayName || reviewer.username : null, confirmedByUser: reviewer ? { id: reviewer.id, username: reviewer.username, displayName: reviewer.displayName } : null };
}

export type BulkReviewItem = { id: string; outcome: string; notes?: string };
export type BulkReviewResult = { id: string; ok: true; outcome: CriticalAssetOutcomeValue } | { id: string; ok: false; code: string; message: string };

@Injectable()
export class CriticalAssetsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CriticalAssetsService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService) {}

  onModuleInit() { this.timer = setInterval(() => void this.runWeeklyChecks().catch((error) => this.logger.error('Weekly critical asset checks failed', error instanceof Error ? error.stack : String(error))), 60_000); this.timer.unref(); void this.runWeeklyChecks().catch((error) => this.logger.error('Weekly critical asset checks failed', error instanceof Error ? error.stack : String(error))); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runWeeklyChecks(now = new Date()) {
    const sites = await this.prisma.site.findMany({ select: { id: true, name: true, timezone: true, criticalCadenceT1Weeks: true, criticalCadenceT2Weeks: true, criticalCadenceT3Weeks: true } });
    for (const site of sites) {
      let window;
      try { window = weeklyWindow(now, site.timezone); } catch { continue; }
      if (!window.due) continue;
      const weekStart = window.weekStart;
      try {
        const devices = await this.prisma.device.findMany({ where: { siteId: site.id, isCritical: true, status: { not: 'RETIRED' } }, select: { id: true, name: true, type: true, criticalityTier: true } });
        for (const device of devices) {
          // A cycle is generated only on this device's cadence Mondays (T2 every 2 weeks, for example).
          if (!isCycleWeek(weekStart, cadenceWeeks(device.criticalityTier, site))) continue;
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

  private async userGroupIds(user: AuthenticatedUser): Promise<string[] | null> {
    if (user.roles.includes('ADMIN')) return null;
    return (await this.prisma.accessGroupMember.findMany({ where: { userId: user.id }, select: { groupId: true } })).map((item) => item.groupId);
  }

  /** Every asset the person may see on this Site: their groups' asset types, plus assets with no owner group. */
  private async scopedAssets(siteId: string, user: AuthenticatedUser, now = new Date()) {
    await this.access.assertSite(user, 'READ', siteId, 'DEVICE');
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { timezone: true, criticalCadenceT1Weeks: true, criticalCadenceT2Weeks: true, criticalCadenceT3Weeks: true } });
    const devices = await this.prisma.device.findMany({ where: { isCritical: true, siteId }, select: { id: true, name: true, type: true, criticalityTier: true, criticalityTierReviewed: true, hostname: true, managementIp: true, serialNumber: true, assetTag: true, status: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    const mapped = await this.prisma.criticalAssetGroupMapping.findMany({ where: { siteId }, include: { group: { select: { id: true, name: true } } } });
    const mappingByType = new Map(mapped.map((mapping) => [mapping.assetType, mapping.group]));
    const groupIds = await this.userGroupIds(user);
    const rows = await this.prisma.criticalAssetAttestation.findMany({ where: { siteId, deviceId: { in: devices.map(({ id }) => id) } }, orderBy: { weekStart: 'desc' } });
    const reviewers = await this.reviewerLookup(rows.map((row) => row.confirmedBy));
    const decorate = (device: (typeof devices)[number]) => {
      const owner = mappingByType.get(device.type) ?? null;
      const history = rows.filter((row) => row.deviceId === device.id);
      const latest = history.find((row) => row.outcome) ?? null;
      return {
        ...device,
        assignedGroup: owner,
        owner,
        cadenceWeeks: cadenceWeeks(device.criticalityTier, site),
        ...computeDueState(history, Boolean(owner), site.timezone, now, cadenceWeeks(device.criticalityTier, site)),
        latestOutcome: latest?.outcome ?? null,
        latestConfirmedAt: latest?.confirmedAt ?? null,
        attestations: history.map((row) => withReviewer(row, reviewers)),
      };
    };
    const visible = devices.filter((device) => !groupIds || mapped.some((mapping) => mapping.assetType === device.type && groupIds.includes(mapping.groupId)));
    const unassigned = devices.filter((device) => !mappingByType.has(device.type));
    return { timezone: site.timezone, mapped, visible: visible.map(decorate), unassigned: unassigned.map(decorate), now };
  }

  async list(siteId: string, user: AuthenticatedUser) {
    const scoped = await this.scopedAssets(siteId, user);
    return { timezone: scoped.timezone, generatedAt: scoped.now.toISOString(), mappings: scoped.mapped, assets: scoped.visible, unassigned: scoped.unassigned };
  }

  /** Paged, server-filtered rows for the workbench: type, owner, last outcome, due state and free text. */
  async page(siteId: string, query: AssetQuery, user: AuthenticatedUser) {
    const scoped = await this.scopedAssets(siteId, user);
    const page = pageAssets([...scoped.visible, ...scoped.unassigned], query);
    return { timezone: scoped.timezone, generatedAt: scoped.now.toISOString(), ...page };
  }

  async summary(siteId: string, user: AuthenticatedUser) {
    const scoped = await this.scopedAssets(siteId, user);
    const groupIds = await this.userGroupIds(user);
    const openCorrections = await this.prisma.criticalAssetCorrection.count({ where: { siteId, status: 'OPEN', ...(groupIds ? { groupId: { in: groupIds } } : {}) } });
    return { timezone: scoped.timezone, generatedAt: scoped.now.toISOString(), counts: { ...summarizeAssets([...scoped.visible, ...scoped.unassigned]), openCorrections } };
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

  /** Guarded write of one review. Returns false when the row was already recorded (concurrent review). */
  private async writeReview(tx: Prisma.TransactionClient, attestation: { id: string; deviceId: string; siteId: string }, groupId: string | null, outcome: CriticalAssetOutcomeValue, notes: string | undefined, user: AuthenticatedUser) {
    const updated = await tx.criticalAssetAttestation.updateMany({ where: { id: attestation.id, outcome: null }, data: { outcome, notes, confirmedAt: new Date(), confirmedBy: user.id } });
    if (!updated.count) return false;
    await tx.auditLog.create({ data: { userId: user.id, action: 'CRITICAL_ASSET_ATTESTATION_RECORDED', entityType: 'Device', entityId: attestation.deviceId, metadata: { outcome, notes, attestationId: attestation.id } } });
    if (outcome === 'NEEDS_CORRECTION') {
      await tx.criticalAssetCorrection.create({ data: { attestationId: attestation.id, deviceId: attestation.deviceId, siteId: attestation.siteId, groupId, description: notes ?? '', requestedBy: user.id } });
    }
    return true;
  }

  private async reviewGroup(siteId: string, assetType: string, userId: string) {
    return this.prisma.criticalAssetGroupMapping.findUnique({ where: { siteId_assetType: { siteId, assetType } }, include: { group: { include: { members: { where: { userId }, select: { userId: true } } } } } });
  }

  async confirm(id: string, outcome: string, notes: string | undefined, user: AuthenticatedUser) {
    const review = validateReview(outcome, notes);
    const attestation = await this.prisma.criticalAssetAttestation.findUnique({ where: { id }, include: { device: true } });
    if (!attestation) throw new BadRequestException('Attestation não encontrada');
    await this.access.assertSite(user, 'READ', attestation.siteId, 'DEVICE', attestation.device.type);
    const mapping = await this.reviewGroup(attestation.siteId, attestation.device.type, user.id);
    if (!user.roles.includes('ADMIN') && !mapping?.group.members.length) throw new ForbiddenException('Não tens acesso a esta revisão');
    if (attestation.outcome) throw this.alreadyRecorded(attestation, await this.reviewerLookup([attestation.confirmedBy]));
    const written = await this.prisma.$transaction((tx) => this.writeReview(tx, attestation, mapping?.groupId ?? null, review.outcome, review.notes, user));
    if (!written) {
      const current = await this.prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id } });
      throw this.alreadyRecorded(current, await this.reviewerLookup([current.confirmedBy]));
    }
    const result = await this.prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id } });
    const reviewers = await this.reviewerLookup([result.confirmedBy]);
    return { ...withReviewer(result, reviewers), inventoryChanged: false };
  }

  /**
   * Bulk review in one transaction with a result per item. Items that cannot be recorded (unknown, outside the
   * person's group, already recorded) are reported and skipped; the rest commit together.
   */
  async confirmBulk(items: unknown, user: AuthenticatedUser) {
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('Indica pelo menos um item');
    if (items.length > BULK_CONFIRM_LIMIT) throw new BadRequestException(`No máximo ${BULK_CONFIRM_LIMIT} itens por pedido`);
    const parsed = items.map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { id: typeof record.id === 'string' ? record.id : '', outcome: record.outcome, notes: record.notes };
    });
    const ids = [...new Set(parsed.map((item) => item.id).filter(Boolean))];
    const attestations = await this.prisma.criticalAssetAttestation.findMany({ where: { id: { in: ids } }, include: { device: true } });
    const byId = new Map(attestations.map((row) => [row.id, row]));
    const membership = new Map<string, { groupId: string | null; isMember: boolean }>();
    const results: BulkReviewResult[] = new Array(parsed.length);
    const accepted: Array<{ index: number; attestation: (typeof attestations)[number]; groupId: string | null; outcome: CriticalAssetOutcomeValue; notes?: string }> = [];
    for (const [index, item] of parsed.entries()) {
      const fail = (code: string, message: string) => { results[index] = { id: item.id, ok: false, code, message }; };
      let review: ReturnType<typeof validateReview>;
      try { review = validateReview(item.outcome, item.notes); } catch (error) { fail('INVALID_REVIEW', error instanceof Error ? error.message : 'Revisão inválida'); continue; }
      const attestation = byId.get(item.id);
      if (!attestation) { fail('NOT_FOUND', 'Attestation não encontrada'); continue; }
      try { await this.access.assertSite(user, 'READ', attestation.siteId, 'DEVICE', attestation.device.type); } catch { fail('FORBIDDEN', 'Não tens acesso a esta revisão'); continue; }
      const key = `${attestation.siteId}:${attestation.device.type}`;
      let group = membership.get(key);
      if (!group) {
        const mapping = await this.reviewGroup(attestation.siteId, attestation.device.type, user.id);
        group = { groupId: mapping?.groupId ?? null, isMember: Boolean(mapping?.group.members.length) };
        membership.set(key, group);
      }
      if (!user.roles.includes('ADMIN') && !group.isMember) { fail('FORBIDDEN', 'Não tens acesso a esta revisão'); continue; }
      if (attestation.outcome) { fail('ALREADY_RECORDED', 'Esta revisão já foi registada.'); continue; }
      accepted.push({ index, attestation, groupId: group.groupId, outcome: review.outcome, notes: review.notes });
    }
    if (accepted.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const entry of accepted) {
          const written = await this.writeReview(tx, entry.attestation, entry.groupId, entry.outcome, entry.notes, user);
          results[entry.index] = written ? { id: entry.attestation.id, ok: true, outcome: entry.outcome } : { id: entry.attestation.id, ok: false, code: 'ALREADY_RECORDED', message: 'Esta revisão já foi registada.' };
        }
      });
    }
    const recorded = results.filter((result) => result.ok).length;
    return { results, recorded, failed: results.length - recorded };
  }

  /** Correction requests for the Site, limited to the person's groups (admins see all). */
  async listCorrections(siteId: string, status: string | undefined, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'READ', siteId, 'DEVICE');
    if (status && !(CORRECTION_STATUSES as readonly string[]).includes(status)) throw new BadRequestException('Estado inválido');
    const groupIds = await this.userGroupIds(user);
    const rows = await this.prisma.criticalAssetCorrection.findMany({
      where: { siteId, ...(status ? { status: status as (typeof CORRECTION_STATUSES)[number] } : {}), ...(groupIds ? { groupId: { in: groupIds } } : {}) },
      include: { device: { select: { id: true, name: true, type: true } } },
      orderBy: [{ requestedAt: 'desc' }],
      take: 500,
    });
    const groups = await this.prisma.accessGroup.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.groupId).filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true } });
    const names = new Map(groups.map((group) => [group.id, group.name]));
    return { items: rows.map((row) => ({ ...row, groupName: row.groupId ? names.get(row.groupId) ?? null : null })) };
  }

  /** Resolves (with the change made) or rejects (with the reason) an open correction. Owning group or admin only. */
  async closeCorrection(id: string, action: 'RESOLVED' | 'REJECTED', body: { changeReference?: string; note?: string }, user: AuthenticatedUser) {
    const correction = await this.prisma.criticalAssetCorrection.findUnique({ where: { id }, include: { device: { select: { type: true } } } });
    if (!correction) throw new BadRequestException('Correção não encontrada');
    await this.access.assertSite(user, 'READ', correction.siteId, 'DEVICE', correction.device.type);
    const member = correction.groupId && !user.roles.includes('ADMIN') ? await this.prisma.accessGroupMember.findUnique({ where: { groupId_userId: { groupId: correction.groupId, userId: user.id } } }) : null;
    if (!user.roles.includes('ADMIN') && !member) throw new ForbiddenException('Não tens acesso a esta correção');
    const changeReference = typeof body.changeReference === 'string' ? body.changeReference.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (action === 'RESOLVED' && !changeReference) throw new BadRequestException('Indica a alteração feita (ligação ou referência).');
    if (action === 'REJECTED' && !note) throw new BadRequestException('Indica o motivo da rejeição.');
    if (correction.status !== 'OPEN') throw new ConflictException({ code: 'CRITICAL_ASSET_CORRECTION_CLOSED', message: 'Esta correção já foi fechada.' });
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.criticalAssetCorrection.updateMany({ where: { id, status: 'OPEN' }, data: { status: action, closedBy: user.id, closedAt: new Date(), closeNote: note || null, changeReference: action === 'RESOLVED' ? changeReference : null } });
      if (!updated.count) throw new ConflictException({ code: 'CRITICAL_ASSET_CORRECTION_CLOSED', message: 'Esta correção já foi fechada.' });
      await tx.auditLog.create({ data: { userId: user.id, action: action === 'RESOLVED' ? 'CRITICAL_ASSET_CORRECTION_RESOLVED' : 'CRITICAL_ASSET_CORRECTION_REJECTED', entityType: 'Device', entityId: correction.deviceId, metadata: { correctionId: id, attestationId: correction.attestationId, changeReference: changeReference || null, note: note || null } } });
      return tx.criticalAssetCorrection.findUniqueOrThrow({ where: { id } });
    });
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
