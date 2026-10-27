import { BadRequestException, ForbiddenException, Injectable, MessageEvent, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { ListAlertsQueryDto, ResolveAlertDto, SnoozeAlertDto, UpsertOperationalAlert } from './dto';

type OperationalEvent = { type: string; alertId?: string; siteId?: string | null; occurredAt: string };

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
    const visible = await this.filterVisibleAlerts(user, candidates);
    const items = visible.slice((page - 1) * pageSize, page * pageSize);
    return { items: items.map(({ userStates, ...item }) => ({ ...item, readAt: userStates[0]?.readAt ?? null })), total: visible.length, page, pageSize };
  }

  async summary(user: AuthenticatedUser, siteId?: string) {
    const siteIds = await this.visibleSiteIds(user);
    if (siteId && !siteIds.includes(siteId) && !user.roles.includes('ADMIN')) throw new NotFoundException('Site não encontrado');
    const where = { AND: [siteId ? { siteId } : { OR: [{ siteId: null }, { siteId: { in: siteIds } }] }, { status: { not: 'RESOLVED' as const } }] };
    const candidates = await this.prisma.operationalAlert.findMany({ where, include: { userStates: { where: { userId: user.id }, select: { readAt: true } } } });
    const visible = await this.filterVisibleAlerts(user, candidates);
    const counts = new Map<string, { status: string; severity: string; _count: { _all: number } }>();
    for (const item of visible) { const key = `${item.status}:${item.severity}`; const group = counts.get(key) ?? { status: item.status, severity: item.severity, _count: { _all: 0 } }; group._count._all += 1; counts.set(key, group); }
    return { total: visible.length, unread: visible.filter((item) => !item.userStates[0]?.readAt).length, groups: [...counts.values()] };
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
        occurrenceCount: { increment: 1 }, lastOccurredAt: now,
        ...(reopen ? { status: 'OPEN' as const, acknowledgedAt: null, acknowledgedById: null, snoozedUntil: null, snoozeReason: null, resolvedAt: null, resolvedById: null, resolutionReason: null } : {}),
      },
    });
    await this.prisma.operationalAlertUserState.updateMany({ where: { alertId: alert.id }, data: { readAt: null } });
    await this.publish({ type: 'alert.upserted', alertId: alert.id, siteId: alert.siteId, occurredAt: now.toISOString() });
    return alert;
  }

  async reconcileSource(source: string, candidates: UpsertOperationalAlert[], scopeSiteId?: string, resolveMissing = true) {
    const activeKeys = new Set(candidates.map((candidate) => candidate.dedupKey));
    for (const candidate of candidates) {
      const existing = await this.prisma.operationalAlert.findUnique({ where: { dedupKey: candidate.dedupKey } });
      if (!existing || existing.status === 'RESOLVED') await this.upsert(candidate);
      else await this.prisma.operationalAlert.update({ where: { id: existing.id }, data: { severity: candidate.severity, title: candidate.title, detail: candidate.detail, actionHref: candidate.actionHref, lastOccurredAt: new Date() } });
    }
    const stale = resolveMissing ? await this.prisma.operationalAlert.findMany({ where: { source, status: { not: 'RESOLVED' }, ...(scopeSiteId ? { siteId: scopeSiteId } : {}), ...(activeKeys.size ? { dedupKey: { notIn: [...activeKeys] } } : {}) }, select: { id: true, siteId: true } }) : [];
    if (stale.length) {
      const now = new Date();
      await this.prisma.operationalAlert.updateMany({ where: { id: { in: stale.map(({ id }) => id) } }, data: { status: 'RESOLVED', resolvedAt: now, resolutionReason: 'Resolvido automaticamente pela reconciliação.' } });
      for (const alert of stale) await this.publish({ type: 'alert.updated', alertId: alert.id, siteId: alert.siteId, occurredAt: now.toISOString() });
    }
    return { active: candidates.length, resolved: stale.length };
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
    const current = await this.mutable(user, id); const until = new Date(dto.until);
    if (until <= new Date()) throw new BadRequestException('A data de snooze tem de ser futura');
    const alert = await this.prisma.operationalAlert.update({ where: { id }, data: { status: 'SNOOZED', snoozedUntil: until, snoozeReason: dto.reason } });
    await this.audit.record({ userId: user.id, action: 'OPERATIONAL_ALERT_SNOOZED', entityType: 'OperationalAlert', entityId: id, metadata: { until, reason: dto.reason } });
    await this.publish({ type: 'alert.updated', alertId: id, siteId: current.siteId, occurredAt: new Date().toISOString() }); return alert;
  }

  async resolve(user: AuthenticatedUser, id: string, dto: ResolveAlertDto) {
    const current = await this.mutable(user, id); const now = new Date();
    const alert = await this.prisma.operationalAlert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: user.id, resolutionReason: dto.reason, snoozedUntil: null } });
    await this.audit.record({ userId: user.id, action: 'OPERATIONAL_ALERT_RESOLVED', entityType: 'OperationalAlert', entityId: id, metadata: { reason: dto.reason } });
    await this.publish({ type: 'alert.updated', alertId: id, siteId: current.siteId, occurredAt: now.toISOString() }); return alert;
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
