import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, MessageEvent, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ALERT_SEVERITY_RANK, alertPolicyDecision } from './alert-policy';
import { NotificationDeliveryService } from '../notifications/delivery/notification-delivery.service';
import { PrismaClient } from '@simoes/database';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { BulkAlertActionDto, ListAlertsQueryDto, ResolveAlertDto, SnoozeAlertDto, UpsertOperationalAlert } from './dto';
import { resolveAlertSnoozeUntil } from './alert-snooze';
import { KNOWN_ALERT_SOURCES } from './alert-sources';

type OperationalEvent = { type: string; alertId?: string; siteId?: string | null; occurredAt: string };
export type AlertDevice = { id: string; name: string; managementIp: string | null };
export type BulkAlertItemResult = { id: string; ok: boolean; status?: string; code?: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'ERROR'; message?: string };
const OPERATOR_ROLES = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'];
const bulkLogger = new Logger('OperationalAlertBulk');
/** One item's failure as a per-item result, so the rest of the batch still runs. */
export function bulkAlertFailure(id: string, error: unknown): BulkAlertItemResult {
  if (error instanceof NotFoundException) return { id, ok: false, code: 'NOT_FOUND', message: 'Alerta não encontrado' };
  if (error instanceof ForbiddenException) return { id, ok: false, code: 'FORBIDDEN', message: error.message };
  if (error instanceof BadRequestException) return { id, ok: false, code: 'INVALID', message: error.message };
  if (error instanceof HttpException) return { id, ok: false, code: 'ERROR', message: error.message };
  bulkLogger.error(`Bulk action failed for alert ${id}`, error instanceof Error ? error.stack : String(error));
  return { id, ok: false, code: 'ERROR', message: 'Erro inesperado ao processar este alerta.' };
}

@Injectable()
export class OperationsService implements OnModuleInit, OnModuleDestroy {
  private readonly events = new Subject<OperationalEvent>();
  private readonly channel = 'mgmt:operations:events';
  private publisher?: Redis;
  private subscriber?: Redis;
  private subscriptionEstablished = false;
  private publisherReady = false;
  private subscriberReady = false;

  private get pubSubReady() {
    return this.publisherReady && this.subscriberReady;
  }

  private trackReadiness(client: Redis, role: 'publisher' | 'subscriber') {
    const setReady = (ready: boolean) => {
      if (role === 'publisher') this.publisherReady = ready;
      else this.subscriberReady = ready && this.subscriptionEstablished;
    };
    client.on('error', () => setReady(false));
    client.on('close', () => setReady(false));
    client.on('reconnecting', () => setReady(false));
    client.on('ready', () => setReady(true));
  }

  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: InfrastructureAccessService,
    private readonly ipamAccess: IpamAccessService,
    private readonly audit: AuditService,
    @Optional() private readonly deliveries?: NotificationDeliveryService,
  ) {}

  async onModuleInit() {
    const options = { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false } as const;
    this.publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', options);
    this.subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', options);
    this.trackReadiness(this.publisher, 'publisher');
    this.trackReadiness(this.subscriber, 'subscriber');
    this.subscriber.on('message', (_channel, value) => {
      try { this.events.next(JSON.parse(value) as OperationalEvent); } catch { /* ignore malformed external events */ }
    });
    // Connect independently: a publisher failure must not prevent the subscriber
    // from recovering and restoring cross-instance event delivery.
    void this.publisher.connect().catch(() => undefined);
    try {
      await this.subscriber.connect();
      await this.subscriber.subscribe(this.channel);
      this.subscriptionEstablished = true;
      this.subscriberReady = this.subscriber.status === 'ready';
    } catch { this.subscriberReady = false; /* PostgreSQL remains the source of truth; clients poll. */ }
  }

  async onModuleDestroy() {
    this.events.complete();
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  private async publish(event: OperationalEvent) {
    if (this.publisher?.status === 'ready') {
      try {
        await this.publisher.publish(this.channel, JSON.stringify(event));
        this.publisherReady = true;
        return;
      } catch {
        this.publisherReady = false;
        /* local delivery below; heartbeat makes other instances poll until recovery */
      }
    }
    this.events.next(event);
  }

  private async canSeeSite(user: AuthenticatedUser, siteId: string | null) {
    if (!siteId || user.roles.includes('ADMIN')) return true;
    try { await this.access.assertSite(user, 'READ', siteId); return true; } catch { return false; }
  }

  private async visibleSiteIds(user: AuthenticatedUser) {
    if (user.roles.includes('ADMIN')) return (await this.prisma.site.findMany({ select: { id: true } })).map((site) => site.id);
    const sites = await this.prisma.site.findMany({ select: { id: true } });
    const visible = await Promise.all(sites.map(async ({ id }) => await this.canSeeSite(user, id) ? id : null));
    return visible.filter((id): id is string => Boolean(id));
  }
  private async canSeeAlert(user: AuthenticatedUser, alert: { siteId: string | null; entityType: string | null; entityId: string | null }): Promise<boolean> {
    if (!alert.siteId) return !alert.entityType || user.roles.includes('ADMIN');
    if (!await this.canSeeSite(user, alert.siteId)) return false;
    if (!alert.entityType || !alert.entityId) return true;
    try {
      if (alert.entityType === 'Device') await this.access.assertDevice(user, 'READ', alert.entityId);
      else if (alert.entityType === 'DeviceInterface') await this.access.assertInterface(user, 'READ', alert.entityId);
      else if (alert.entityType === 'DiscoveryJob') {
        const item = await this.prisma.discoveryJob.findUnique({ where: { id: alert.entityId }, select: { subnetId: true } });
        if (!item) return false; await this.ipamAccess.assertSubnet(user, 'READ', item.subnetId);
      } else if (alert.entityType === 'SnmpJob') {
        const item = await this.prisma.snmpJob.findUnique({ where: { id: alert.entityId }, select: { deviceId: true } });
        if (!item) return false; await this.access.assertDevice(user, 'READ', item.deviceId);
      } else if (alert.entityType === 'SnmpDrift') {
        const item = await this.prisma.snmpDrift.findUnique({ where: { id: alert.entityId }, select: { deviceId: true } });
        if (!item) return false; await this.access.assertDevice(user, 'READ', item.deviceId);
      } else if (alert.entityType === 'SnmpTrapEvent') {
        const item = await this.prisma.snmpTrapEvent.findUnique({ where: { id: alert.entityId }, select: { deviceId: true } });
        if (!item) return false; if (item.deviceId) await this.access.assertDevice(user, 'READ', item.deviceId);
      } else if (alert.entityType === 'InventoryFinding') {
        const finding = await this.prisma.inventoryFinding.findUnique({ where: { id: alert.entityId }, select: { siteId: true, entityType: true, entityId: true } });
        if (!finding) return false; return this.canSeeAlert(user, finding);
      } else return false;
      return true;
    } catch { return false; }
  }
  private async filterVisibleAlerts<T extends { siteId: string | null; entityType: string | null; entityId: string | null }>(user: AuthenticatedUser, items: T[]) {
    if (user.roles.includes('ADMIN')) return items;
    const visible: T[] = [];
    for (const item of items) if (await this.canSeeAlert(user, item)) visible.push(item);
    return visible;
  }
  private async applyAlertPolicies<T extends { source: string; siteId: string | null; severity: string }>(items: T[], now = new Date()) {
    if (!items.length) return items;
    const [rules, windows] = await Promise.all([
      this.prisma.alertRule.findMany({ where: { enabled: true }, select: { source: true, siteId: true, minSeverity: true } }),
      this.prisma.maintenanceWindow.findMany({ where: { startsAt: { lte: now }, endsAt: { gt: now } }, select: { siteId: true } }),
    ]);
    return items.filter((item) => alertPolicyDecision(rules, windows, item) === 'SHOWN');
  }
  private async canOperateSite(user: AuthenticatedUser, siteId: string) {
    if (user.roles.includes('ADMIN')) return true;
    try {
      const effective = await this.access.effectiveAccess(user, siteId);
      return [effective.infrastructure.site, ...effective.infrastructure.buildings.map((item) => item.actions), ...effective.infrastructure.rooms.map((item) => item.actions)]
        .some((actions) => actions.some((action) => action === 'CREATE' || action === 'UPDATE' || action === 'DELETE'));
    } catch { return false; }
  }

  async list(user: AuthenticatedUser, query: ListAlertsQueryDto = {}) {
    const page = Math.max(Number(query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 100);
    const siteIds = await this.visibleSiteIds(user);
    if (query.siteId && !siteIds.includes(query.siteId) && !user.roles.includes('ADMIN')) throw new NotFoundException('Site não encontrado');
    const where = {
      AND: [
        query.siteId ? { siteId: query.siteId } : { OR: [{ siteId: null }, { siteId: { in: siteIds } }] },
        ...(query.status ? [{ status: query.status }] : [{ status: { not: 'RESOLVED' as const } }]),
        ...(query.severity ? [{ severity: query.severity }] : []),
        ...(query.source ? [{ source: query.source }] : []),
        ...(query.search ? [{ OR: [{ title: { contains: query.search, mode: 'insensitive' as const } }, { detail: { contains: query.search, mode: 'insensitive' as const } }] }] : []),
      ],
    };
    const candidates = await this.prisma.operationalAlert.findMany({ where, orderBy: [{ severity: 'asc' }, { lastOccurredAt: 'desc' }], include: { site: { select: { id: true, name: true } }, userStates: { where: { userId: user.id }, select: { readAt: true } } } });
    const visible = await this.applyAlertPolicies(await this.filterVisibleAlerts(user, candidates));
    const items = visible.slice((page - 1) * pageSize, page * pageSize);
    const devices = await this.relatedDevices(items);
    return { items: items.map(({ userStates, ...item }) => { const device = devices.get(item.id) ?? null; return { ...item, relatedDeviceId: device?.id ?? null, device, readAt: userStates[0]?.readAt ?? null }; }), total: visible.length, page, pageSize };
  }

  /**
   * The device each alert is about: the entity itself, or the device that owns the SNMP job, drift,
   * trap or interface. Keyed by alert id; alerts with no device are left out.
   */
  private async relatedDevices(items: Array<{ id: string; entityType: string | null; entityId: string | null }>) {
    const ids = (type: string) => items.filter((item) => item.entityType === type && item.entityId).map((item) => item.entityId!);
    const lookup = <T,>(list: string[], query: () => Promise<T[]>) => (list.length ? query() : Promise.resolve([] as T[]));
    const [jobs, drifts, traps, interfaces] = await Promise.all([
      lookup(ids('SnmpJob'), () => this.prisma.snmpJob.findMany({ where: { id: { in: ids('SnmpJob') } }, select: { id: true, deviceId: true } })),
      lookup(ids('SnmpDrift'), () => this.prisma.snmpDrift.findMany({ where: { id: { in: ids('SnmpDrift') } }, select: { id: true, deviceId: true } })),
      lookup(ids('SnmpTrapEvent'), () => this.prisma.snmpTrapEvent.findMany({ where: { id: { in: ids('SnmpTrapEvent') } }, select: { id: true, deviceId: true } })),
      lookup(ids('DeviceInterface'), () => this.prisma.deviceInterface.findMany({ where: { id: { in: ids('DeviceInterface') } }, select: { id: true, deviceId: true } })),
    ]);
    const owners = new Map<string, string | null>([...jobs, ...drifts, ...traps, ...interfaces].map((item) => [item.id, item.deviceId] as const));
    const deviceIdByAlert = new Map<string, string>();
    for (const item of items) {
      const deviceId = item.entityType === 'Device' ? item.entityId : owners.get(item.entityId ?? '') ?? null;
      if (deviceId) deviceIdByAlert.set(item.id, deviceId);
    }
    const deviceIds = [...new Set(deviceIdByAlert.values())];
    const devices = deviceIds.length ? await this.prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, managementIp: true } }) : [];
    const byId = new Map(devices.map((device) => [device.id, device] as const));
    const result = new Map<string, AlertDevice>();
    // A deleted device still keeps its id, so the alert can say which device it was about.
    for (const [alertId, deviceId] of deviceIdByAlert) result.set(alertId, byId.get(deviceId) ?? { id: deviceId, name: '', managementIp: null });
    return result;
  }

  /** One alert with its device, who acted on it, and its audit history (newest first, at most 50 entries). */
  async detail(user: AuthenticatedUser, id: string) {
    const alert = await this.prisma.operationalAlert.findUnique({ where: { id }, include: {
      site: { select: { id: true, name: true } },
      acknowledgedBy: { select: { id: true, username: true, displayName: true } },
      resolvedBy: { select: { id: true, username: true, displayName: true } },
    } });
    if (!alert || !await this.canSeeAlert(user, alert)) throw new NotFoundException('Alerta não encontrado');
    const [devices, history, canAct] = await Promise.all([
      this.relatedDevices([alert]),
      this.prisma.auditLog.findMany({ where: { entityType: 'OperationalAlert', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, metadata: true, createdAt: true, user: { select: { id: true, username: true, displayName: true } } } }),
      this.canAct(user, alert.siteId),
    ]);
    const device = devices.get(alert.id) ?? null;
    return { ...alert, relatedDeviceId: device?.id ?? null, device, canAct, history };
  }

  /** Whether the user may acknowledge, snooze or resolve alerts of this Site (global alerts: ADMIN only). */
  private async canAct(user: AuthenticatedUser, siteId: string | null) {
    if (!user.roles.some((role) => OPERATOR_ROLES.includes(role))) return false;
    if (!siteId) return user.roles.includes('ADMIN');
    return this.canOperateSite(user, siteId);
  }

  /** Event types for alert rules: the known producers plus any other source already stored. */
  async sources() {
    const stored = await this.prisma.operationalAlert.findMany({ distinct: ['source'], select: { source: true } });
    return { items: [...new Set([...KNOWN_ALERT_SOURCES, ...stored.map((item) => item.source)])] };
  }

  async summary(user: AuthenticatedUser, siteId?: string) {
    const siteIds = await this.visibleSiteIds(user);
    if (siteId && !siteIds.includes(siteId) && !user.roles.includes('ADMIN')) throw new NotFoundException('Site não encontrado');
    const where = { AND: [siteId ? { siteId } : { OR: [{ siteId: null }, { siteId: { in: siteIds } }] }, { status: { not: 'RESOLVED' as const } }] };
    const candidates = await this.prisma.operationalAlert.findMany({ where, include: { userStates: { where: { userId: user.id }, select: { readAt: true } } } });
    const visible = await this.applyAlertPolicies(await this.filterVisibleAlerts(user, candidates));
    const counts = new Map<string, { status: string; severity: string; _count: { _all: number } }>();
    for (const item of visible) { const key = `${item.status}:${item.severity}`; const group = counts.get(key) ?? { status: item.status, severity: item.severity, _count: { _all: 0 } }; group._count._all += 1; counts.set(key, group); }
    return { total: visible.length, unread: visible.filter((item) => !item.userStates[0]?.readAt).length, groups: [...counts.values()] };
  }

  /** Active and upcoming maintenance windows (global plus visible Sites) for the Alertas header. */
  async maintenanceSummary(user: AuthenticatedUser, siteId?: string, days?: number | string) {
    const horizonDays = Math.min(Math.max(Math.trunc(Number(days ?? 7)) || 7, 1), 90);
    const siteIds = await this.visibleSiteIds(user);
    if (siteId && !siteIds.includes(siteId)) throw new NotFoundException('Site não encontrado');
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
    const scope = siteId ? { OR: [{ siteId: null }, { siteId }] } : { OR: [{ siteId: null }, { siteId: { in: siteIds } }] };
    const select = { id: true, name: true, reason: true, siteId: true, startsAt: true, endsAt: true, site: { select: { id: true, name: true } } } as const;
    const [active, upcoming, upcomingTotal] = await Promise.all([
      this.prisma.maintenanceWindow.findMany({ where: { AND: [scope, { startsAt: { lte: now } }, { endsAt: { gt: now } }] }, orderBy: { endsAt: 'asc' }, take: 50, select }),
      this.prisma.maintenanceWindow.findMany({ where: { AND: [scope, { startsAt: { gt: now, lte: horizon } }] }, orderBy: { startsAt: 'asc' }, take: 50, select }),
      this.prisma.maintenanceWindow.count({ where: { AND: [scope, { startsAt: { gt: now, lte: horizon } }] } }),
    ]);
    return {
      generatedAt: now.toISOString(),
      horizonDays,
      counts: { active: active.length, upcoming: upcomingTotal },
      nextStartsAt: upcoming[0]?.startsAt ?? null,
      active,
      upcoming,
      criticalAlertsUnaffected: true,
    };
  }

  async upsert(input: UpsertOperationalAlert) {
    const now = new Date();
    const existing = await this.prisma.operationalAlert.findUnique({ where: { dedupKey: input.dedupKey }, select: { status: true } });
    const reopen = existing?.status === 'RESOLVED';
    const alert = await this.prisma.operationalAlert.upsert({
      where: { dedupKey: input.dedupKey },
      create: { ...input, status: 'OPEN', firstOccurredAt: now, lastOccurredAt: now },
      update: {
        source: input.source, severity: input.severity, siteId: input.siteId, entityType: input.entityType,
        entityId: input.entityId, title: input.title, detail: input.detail, actionHref: input.actionHref,
        occurrenceCount: input.occurrenceCount ?? { increment: 1 }, lastOccurredAt: now,
        ...(reopen ? { status: 'OPEN' as const, acknowledgedAt: null, acknowledgedById: null, snoozedUntil: null, snoozeReason: null, resolvedAt: null, resolvedById: null, resolutionReason: null } : {}),
      },
    });
    await this.prisma.operationalAlertUserState.updateMany({ where: { alertId: alert.id }, data: { readAt: null } });
    await this.publish({ type: 'alert.upserted', alertId: alert.id, siteId: alert.siteId, occurredAt: now.toISOString() });
    // Step 31: only a new or reopened alert is posted to the group channel; repeats of an open alert are not.
    if (!existing || reopen) void this.deliveries?.alertOpened(alert, now);
    return alert;
  }

  /**
   * resolveKeys: dedup keys whose underlying condition is known to be cleared (e.g. an SNMP
   * recovery trap). They resolve through the same path as stale alerts, even when a capped
   * candidate list turns resolveMissing off.
   */
  async reconcileSource(source: string, candidates: UpsertOperationalAlert[], scopeSiteId?: string, resolveMissing = true, resolveKeys: string[] = []) {
    const activeKeys = new Set(candidates.map((candidate) => candidate.dedupKey));
    for (const candidate of candidates) {
      const existing = await this.prisma.operationalAlert.findUnique({ where: { dedupKey: candidate.dedupKey } });
      if (!existing || existing.status === 'RESOLVED') await this.upsert(candidate);
      else {
        // siteId/entityType follow the candidate too: a trap source that becomes ambiguous moves to ADMIN-only (siteId null,
        // entityType SnmpTrapSource), and back to its device's site when the ambiguity goes away.
        const updated = await this.prisma.operationalAlert.update({ where: { id: existing.id }, data: { severity: candidate.severity, siteId: candidate.siteId, entityType: candidate.entityType, title: candidate.title, detail: candidate.detail, actionHref: candidate.actionHref, entityId: candidate.entityId, ...(candidate.occurrenceCount === undefined ? {} : { occurrenceCount: candidate.occurrenceCount }), lastOccurredAt: new Date() } });
        // An open alert that escalates (for example HIGH → CRITICAL) is posted again at its new severity.
        if ((ALERT_SEVERITY_RANK[updated.severity] ?? 99) < (ALERT_SEVERITY_RANK[existing.severity] ?? 99)) void this.deliveries?.alertOpened(updated, updated.lastOccurredAt);
      }
    }
    const cleared = resolveKeys.filter((key) => !activeKeys.has(key));
    const stale = !resolveMissing && cleared.length ? await this.findOpenByKeys(source, cleared, scopeSiteId) : resolveMissing ? await this.prisma.operationalAlert.findMany({ where: { source, status: { not: 'RESOLVED' }, ...(scopeSiteId ? { siteId: scopeSiteId } : {}), ...(activeKeys.size ? { dedupKey: { notIn: [...activeKeys] } } : {}) }, select: { id: true, siteId: true } }) : [];
    if (stale.length) {
      const now = new Date();
      for (let i = 0; i < stale.length; i += 1000) await this.prisma.operationalAlert.updateMany({ where: { id: { in: stale.slice(i, i + 1000).map(({ id }) => id) } }, data: { status: 'RESOLVED', resolvedAt: now, resolutionReason: 'Resolvido automaticamente pela reconciliação.' } });
      for (const alert of stale) await this.publish({ type: 'alert.updated', alertId: alert.id, siteId: alert.siteId, occurredAt: now.toISOString() });
    }
    return { active: candidates.length, resolved: stale.length };
  }

  /** Open alerts of a source with one of the given dedup keys, queried in batches of 1,000 keys. */
  private async findOpenByKeys(source: string, keys: string[], scopeSiteId?: string) {
    const found: Array<{ id: string; siteId: string | null }> = [];
    for (let i = 0; i < keys.length; i += 1000) found.push(...await this.prisma.operationalAlert.findMany({ where: { source, status: { not: 'RESOLVED' }, ...(scopeSiteId ? { siteId: scopeSiteId } : {}), dedupKey: { in: keys.slice(i, i + 1000) } }, select: { id: true, siteId: true } }));
    return found;
  }

  async reopenExpiredSnoozes(now = new Date()) {
    const expired = await this.prisma.operationalAlert.findMany({ where: { status: 'SNOOZED', snoozedUntil: { lte: now } }, select: { id: true, siteId: true } });
    if (!expired.length) return { reopened: 0 };
    await this.prisma.operationalAlert.updateMany({ where: { id: { in: expired.map((item) => item.id) } }, data: { status: 'OPEN', snoozedUntil: null, snoozeReason: null, acknowledgedAt: null, acknowledgedById: null } });
    for (const alert of expired) await this.publish({ type: 'alert.updated', alertId: alert.id, siteId: alert.siteId, occurredAt: now.toISOString() });
    return { reopened: expired.length };
  }

  private async mutable(user: AuthenticatedUser, id: string) {
    const alert = await this.prisma.operationalAlert.findUnique({ where: { id } });
    if (!alert || !await this.canSeeAlert(user, alert)) throw new NotFoundException('Alerta não encontrado');
    if (!alert.siteId && !user.roles.includes('ADMIN')) throw new ForbiddenException('Apenas ADMIN pode alterar alertas globais');
    if (alert.siteId && !await this.canOperateSite(user, alert.siteId)) throw new ForbiddenException('Não tens permissão operacional neste Site');
    return alert;
  }

  async acknowledge(user: AuthenticatedUser, id: string) {
    const current = await this.mutable(user, id); const now = new Date();
    const alert = await this.prisma.operationalAlert.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedById: user.id, snoozedUntil: null } });
    await this.audit.record({ userId: user.id, action: 'OPERATIONAL_ALERT_ACKNOWLEDGED', entityType: 'OperationalAlert', entityId: id });
    await this.publish({ type: 'alert.updated', alertId: id, siteId: current.siteId, occurredAt: now.toISOString() }); return alert;
  }

  async snooze(user: AuthenticatedUser, id: string, dto: SnoozeAlertDto) {
    return this.applySnooze(user, id, resolveAlertSnoozeUntil(dto), dto.reason);
  }

  private async applySnooze(user: AuthenticatedUser, id: string, until: Date, reason?: string) {
    const current = await this.mutable(user, id);
    const alert = await this.prisma.operationalAlert.update({ where: { id }, data: { status: 'SNOOZED', snoozedUntil: until, snoozeReason: reason } });
    await this.audit.record({ userId: user.id, action: 'OPERATIONAL_ALERT_SNOOZED', entityType: 'OperationalAlert', entityId: id, metadata: { until, reason } });
    await this.publish({ type: 'alert.updated', alertId: id, siteId: current.siteId, occurredAt: new Date().toISOString() }); return alert;
  }

  async resolve(user: AuthenticatedUser, id: string, dto: ResolveAlertDto) {
    const current = await this.mutable(user, id); const now = new Date();
    const alert = await this.prisma.operationalAlert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: user.id, resolutionReason: dto.reason, snoozedUntil: null } });
    await this.audit.record({ userId: user.id, action: 'OPERATIONAL_ALERT_RESOLVED', entityType: 'OperationalAlert', entityId: id, metadata: { reason: dto.reason } });
    await this.publish({ type: 'alert.updated', alertId: id, siteId: current.siteId, occurredAt: now.toISOString() }); return alert;
  }

  /**
   * ACKNOWLEDGE, SNOOZE or RESOLVE up to 200 alerts. Each one is checked and reported on its own
   * (same rules as the single-alert routes); one failure does not stop the rest.
   */
  async bulk(user: AuthenticatedUser, dto: BulkAlertActionDto) {
    if (dto.action !== 'SNOOZE' && (dto.until !== undefined || dto.durationHours !== undefined)) throw new BadRequestException({ code: 'BULK_FIELDS_INVALID', message: 'until/durationHours só se aplicam a SNOOZE.' });
    if (dto.action === 'ACKNOWLEDGE' && dto.reason !== undefined) throw new BadRequestException({ code: 'BULK_FIELDS_INVALID', message: 'reason só se aplica a SNOOZE e RESOLVE.' });
    const until = dto.action === 'SNOOZE' ? resolveAlertSnoozeUntil(dto) : undefined;
    const results: BulkAlertItemResult[] = [];
    for (const id of dto.ids) {
      try {
        const updated = dto.action === 'ACKNOWLEDGE' ? await this.acknowledge(user, id)
          : dto.action === 'SNOOZE' ? await this.applySnooze(user, id, until!, dto.reason)
          : await this.resolve(user, id, { reason: dto.reason });
        results.push({ id, ok: true, status: updated.status });
      } catch (error) { results.push(bulkAlertFailure(id, error)); }
    }
    const succeeded = results.filter((item) => item.ok).length;
    return { action: dto.action, results, succeeded, failed: results.length - succeeded, ...(until ? { snoozedUntil: until.toISOString() } : {}) };
  }

  async readAll(user: AuthenticatedUser) {
    const siteIds = await this.visibleSiteIds(user);
    const candidates = await this.prisma.operationalAlert.findMany({ where: { OR: [{ siteId: null }, { siteId: { in: siteIds } }], status: { not: 'RESOLVED' } }, select: { id: true, siteId: true, entityType: true, entityId: true } });
    const items = await this.filterVisibleAlerts(user, candidates);
    if (!items.length) return { updated: 0 };
    const now = new Date();
    await this.prisma.operationalAlertUserState.createMany({ data: items.map((item) => ({ alertId: item.id, userId: user.id, readAt: now })), skipDuplicates: true });
    await this.prisma.operationalAlertUserState.updateMany({ where: { userId: user.id, alertId: { in: items.map((item) => item.id) } }, data: { readAt: now } });
    return { updated: items.length };
  }

  stream(user: AuthenticatedUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      void this.summary(user).then((data) => { if (!closed) subscriber.next({ type: 'snapshot', data }); }).catch((error) => subscriber.error(error));
      const subscription = this.events.subscribe((event) => {
        void (event.alertId ? this.prisma.operationalAlert.findUnique({ where: { id: event.alertId } }).then((alert) => alert ? this.canSeeAlert(user, alert) : false) : this.canSeeSite(user, event.siteId ?? null)).then((allowed) => { if (allowed && !closed) subscriber.next({ type: event.type, data: event }); });
      });
      const heartbeat = setInterval(() => subscriber.next({ type: 'heartbeat', data: { at: new Date().toISOString(), pubSubAvailable: this.pubSubReady } }), 15_000);
      return () => { closed = true; clearInterval(heartbeat); subscription.unsubscribe(); };
    });
  }
}
