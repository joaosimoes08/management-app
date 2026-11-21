import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import type { AuthenticatedUser } from '../auth/auth.service';
import { isApplicationRole } from '../auth/roles';
import { ChangePlansService } from '../change-plans/change-plans.service';
import { CriticalAssetsService } from '../critical-assets/critical-assets.service';
import { SiteCapacityService } from '../infrastructure/capacity/site-capacity.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { LifecycleDatesService } from '../infrastructure/lifecycle-dates.service';
import { InventoryQualityService } from '../inventory-quality/inventory-quality.service';
import {
  CapacitySection, ChangesSection, ComplianceGroup, ComplianceSection, LifecycleSection, QualitySection, ReportDocument, ReportSection, REPORT_SECTIONS, SiteReport,
} from './report-content';
import { addDays, isoDay, lastDay, localMidnight, localToday, ReportPeriod } from './report-schedule';

/** Same roles as the source endpoints' controller guards (critical assets: @Roles VIEWERS). */
const ATTESTATION_VIEWERS = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR'];
/** The capacity outlook endpoint's default thresholds (parseThresholds). */
export const CAPACITY_THRESHOLDS = { warningPercent: 80, criticalPercent: 90 };
export const LIFECYCLE_DAYS = 90;
export const CHANGE_STATUSES = 'COMPLETED,FAILED,ROLLED_BACK';

export type ReportDefinition = { id: string; name: string; frequency: 'WEEKLY' | 'MONTHLY'; timezone: string; sections: string[]; siteIds: string[] };
type Attestation = { weekStart: Date | string; dueAt: string; outcome?: string | null; confirmedAt?: Date | string | null };
type ComplianceAsset = { id: string; owner?: { name: string } | null; attestations: Attestation[] };

/** A refusal from a source endpoint means "not for this person": the section is reported as unavailable. */
const denied = (error: unknown) => error instanceof ForbiddenException || error instanceof NotFoundException;
const day = (value: Date | string) => (value instanceof Date ? value.toISOString() : value).slice(0, 10);

/**
 * Compliance for cycles that opened in the period, with the same rule as the web compliance view (complianceCells):
 * per owner group, a cycle is on time when its outcome was recorded before its `dueAt` from the API.
 */
export function compliance(assets: ComplianceAsset[], period: ReportPeriod): ComplianceSection {
  const from = isoDay(period.start); const to = isoDay(period.end);
  const byGroup = new Map<string, { expected: number; onTime: number }>();
  for (const asset of assets) {
    const group = asset.owner?.name;
    if (!group) continue;
    for (const item of asset.attestations) {
      const week = day(item.weekStart);
      if (week < from || week >= to) continue;
      const entry = byGroup.get(group) ?? { expected: 0, onTime: 0 };
      entry.expected += 1;
      if (item.outcome && item.confirmedAt && new Date(item.confirmedAt).getTime() < new Date(item.dueAt).getTime()) entry.onTime += 1;
      byGroup.set(group, entry);
    }
  }
  const percent = (onTime: number, expected: number) => (expected ? Math.round((onTime / expected) * 100) : null);
  const groups: ComplianceGroup[] = [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, { expected, onTime }]) => ({ group, expected, onTime, percent: percent(onTime, expected) }));
  const expected = groups.reduce((sum, group) => sum + group.expected, 0); const onTime = groups.reduce((sum, group) => sum + group.onTime, 0);
  return { available: true, expected, onTime, percent: percent(onTime, expected), groups };
}

/**
 * Builds a report for one person by calling the same service methods as the source endpoints with that person's
 * identity, so the figures and the Sites they cover match what the person would see in the app.
 */
@Injectable()
export class ReportGeneratorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: InfrastructureAccessService,
    private readonly criticalAssets: CriticalAssetsService,
    private readonly lifecycle: LifecycleDatesService,
    private readonly quality: InventoryQualityService,
    private readonly capacity: SiteCapacityService,
    private readonly changes: ChangePlansService,
  ) {}

  /** The identity a recipient has in the app: roles as stored at their last sign-in. */
  async identity(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, externalId: true, username: true, roles: { select: { role: true } } } });
    if (!user) return null;
    return { id: user.id, externalId: user.externalId, username: user.username, roles: [...new Set(user.roles.map(({ role }) => role as string).filter(isApplicationRole))] };
  }

  /** The report's Sites (all Sites when none is chosen) that this person may read, by name. */
  async sitesFor(user: AuthenticatedUser, siteIds: string[]) {
    const sites = await this.prisma.site.findMany({ where: siteIds.length ? { id: { in: siteIds } } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const visible = await Promise.all(sites.map((site) => this.access.assertSite(user, 'READ', site.id).then(() => true, () => false)));
    return sites.filter((_, index) => visible[index]);
  }

  async build(definition: ReportDefinition, user: AuthenticatedUser, period: ReportPeriod, now = new Date()): Promise<ReportDocument> {
    const sections = REPORT_SECTIONS.filter((section) => definition.sections.includes(section));
    const sites = await this.sitesFor(user, definition.siteIds);
    const reports: SiteReport[] = [];
    for (const site of sites) reports.push(await this.site(site, sections, user, period, definition.timezone, now));
    return {
      reportId: definition.id, reportName: definition.name, frequency: definition.frequency, timezone: definition.timezone,
      periodStart: isoDay(period.start), periodEnd: isoDay(lastDay(period)), generatedAt: now.toISOString(), sections, sites: reports,
    };
  }

  private async site(site: { id: string; name: string }, sections: ReportSection[], user: AuthenticatedUser, period: ReportPeriod, timezone: string, now: Date) {
    const report: SiteReport = { siteId: site.id, siteName: site.name };
    const guard = async <T>(run: () => Promise<T>): Promise<T | { available: false }> => {
      try { return await run(); } catch (error) { if (denied(error)) return { available: false }; throw error; }
    };
    if (sections.includes('COMPLIANCE')) report.compliance = await guard(() => this.complianceFor(site.id, user, period));
    if (sections.includes('LIFECYCLE')) report.lifecycle = await guard(() => this.lifecycleFor(site.id, user, timezone, now));
    if (sections.includes('QUALITY')) report.quality = await guard(() => this.qualityFor(site.id, user));
    if (sections.includes('CAPACITY')) report.capacity = await guard(() => this.capacityFor(site.id, user, now));
    if (sections.includes('CHANGES')) report.changes = await guard(() => this.changesFor(site.id, user, period, timezone));
    return report;
  }

  /** GET /critical-assets?siteId (VIEWERS only), assets and unassigned merged by id as in the web view. */
  private async complianceFor(siteId: string, user: AuthenticatedUser, period: ReportPeriod): Promise<ComplianceSection> {
    if (!ATTESTATION_VIEWERS.some((role) => (user.roles as string[]).includes(role))) return { available: false };
    const data = await this.criticalAssets.list(siteId, user);
    const byId = new Map<string, ComplianceAsset>();
    for (const asset of [...data.assets, ...data.unassigned] as unknown as ComplianceAsset[]) if (!byId.has(asset.id)) byId.set(asset.id, asset);
    return compliance([...byId.values()], period);
  }

  /** GET /lifecycle-dates?siteId&from=today&to=today+90 (report time zone). */
  private async lifecycleFor(siteId: string, user: AuthenticatedUser, timezone: string, now: Date): Promise<LifecycleSection> {
    const today = localToday(now, timezone);
    const from = isoDay(today); const to = isoDay(addDays(today, LIFECYCLE_DAYS));
    const { items } = await this.lifecycle.list(user, siteId, from, to);
    return { available: true, from, to, items: items.map((item) => ({ deviceName: item.device.name, kind: item.kind, dueDate: item.dueDate })) };
  }

  /** GET /inventory-quality/summary?siteId: open (not resolved) findings, summed by severity. */
  private async qualityFor(siteId: string, user: AuthenticatedUser): Promise<QualitySection> {
    const summary = await this.quality.summary(user, siteId);
    const bySeverity: Record<string, number> = {};
    for (const group of summary.groups) bySeverity[group.severity] = (bySeverity[group.severity] ?? 0) + group._count._all;
    return { available: true, total: summary.findingCount, bySeverity };
  }

  /** GET /sites/:id/capacity-outlook with the default 80/90 thresholds: items at warning or critical level. */
  private async capacityFor(siteId: string, user: AuthenticatedUser, now: Date): Promise<CapacitySection> {
    const outlook = await this.capacity.outlook(siteId, user, CAPACITY_THRESHOLDS, now);
    const items = outlook.items.filter((item) => item.level === 'warning' || item.level === 'critical')
      .map((item) => ({ kind: item.kind, name: item.rackName && item.kind !== 'RACK_SPACE' && item.kind !== 'RACK_POWER' ? `${item.rackName} · ${item.name}` : item.name, level: item.level as 'warning' | 'critical', currentPercent: item.currentPercent === null ? null : Math.round(item.currentPercent) }))
      .sort((a, b) => (a.level === b.level ? (b.currentPercent ?? 0) - (a.currentPercent ?? 0) : a.level === 'critical' ? -1 : 1));
    return { available: true, ...CAPACITY_THRESHOLDS, critical: items.filter((item) => item.level === 'critical').length, warning: items.filter((item) => item.level === 'warning').length, items };
  }

  /** GET /change-plans?siteId&status=COMPLETED,FAILED,ROLLED_BACK&from&to (period, report time zone). */
  private async changesFor(siteId: string, user: AuthenticatedUser, period: ReportPeriod, timezone: string): Promise<ChangesSection> {
    const plans = await this.changes.list(user, siteId, { status: CHANGE_STATUSES, from: localMidnight(period.start, timezone).toISOString(), to: localMidnight(period.end, timezone).toISOString() });
    const count = (status: string) => plans.filter((plan) => plan.status === status).length;
    return {
      available: true, completed: count('COMPLETED'), failed: count('FAILED'), rolledBack: count('ROLLED_BACK'),
      items: plans.map((plan) => ({ title: plan.title, status: plan.status, plannedStartAt: new Date(plan.plannedStartAt).toISOString() })),
    };
  }
}
