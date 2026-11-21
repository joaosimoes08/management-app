import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChangeEntityType, ChangePlanStatus, Prisma, PrismaClient } from '@simoes/database';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { computeOverlaps } from './change-windows';
import { ChangePlanItemDto, CreateChangePlanDto, ReviewChangePlanDto, UpdateChangePlanDto } from './dto';

const IMPACT_LIMIT = 400;
const CREATORS = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'];
const VIEWERS = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'];
const ACTIVE_CONFLICT_STATUSES = [ChangePlanStatus.SUBMITTED, ChangePlanStatus.APPROVED];
const CALENDAR_MAX_DAYS = 120;
const CALENDAR_LIMIT = 500;
const DAY = 24 * 60 * 60 * 1000;
export type ChangePlanListFilters = { status?: string; from?: string; to?: string; q?: string };
type GraphNode = { key: string; entityType: ChangeEntityType; entityId: string; label: string; href: string; siteId: string; updatedAt?: Date; observedAt?: Date; source?: string };
type GraphEdge = { from: string; to: string; relationship: string; source: string; confidence: 'RECORDED' | 'LOW'; updatedAt?: Date };
type ImpactEntry = GraphNode & { depth: number; dependencyPath: string[]; freshness: string; confidence: 'RECORDED' | 'LOW' };

@Injectable()
export class ChangePlansService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly infrastructure: InfrastructureAccessService, private readonly ipam: IpamAccessService) {}

  private requireRole(user: AuthenticatedUser, roles: string[]) {
    if (!roles.some((role) => user.roles.includes(role as never))) throw new ForbiddenException();
  }
  private isVisibilityFailure(error: unknown) { return error instanceof NotFoundException || error instanceof ForbiddenException; }
  private hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private isStatus(status: ChangePlanStatus, ...allowed: ChangePlanStatus[]) { return allowed.includes(status); }
  private assertWindow(start: string | Date, end: string | Date) {
    const startsAt = new Date(start); const endsAt = new Date(end);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new BadRequestException({ code: 'CHANGE_WINDOW_INVALID', message: 'A data e hora de fim têm de ser posteriores ao início.' });
  }

  private async assertSite(user: AuthenticatedUser, siteId: string, action: 'READ' | 'CREATE' | 'UPDATE') {
    let infrastructureError: unknown; let ipamError: unknown;
    try { await this.infrastructure.assertSite(user, action, siteId, 'DEVICE', 'SWITCH'); return; } catch (error) { infrastructureError = error; }
    try { await this.ipam.assertSite(user, action, siteId); return; } catch (error) { ipamError = error; }
    if (infrastructureError instanceof NotFoundException || ipamError instanceof NotFoundException) throw new NotFoundException({ code: 'CHANGE_SITE_NOT_FOUND', message: 'Site não encontrado ou sem acesso.' });
    throw new ForbiddenException({ code: 'CHANGE_SITE_FORBIDDEN', message: 'Não tens permissão para gerir alterações neste Site.' });
  }

  private async targetSite(entityType: ChangeEntityType, entityId: string): Promise<string | null> {
    switch (entityType) {
      case ChangeEntityType.DEVICE: return (await this.prisma.device.findUnique({ where: { id: entityId }, select: { siteId: true } }))?.siteId ?? null;
      case ChangeEntityType.INTERFACE: return (await this.prisma.deviceInterface.findUnique({ where: { id: entityId }, select: { device: { select: { siteId: true } } } }))?.device.siteId ?? null;
      case ChangeEntityType.VLAN: return (await this.prisma.vlan.findUnique({ where: { id: entityId }, select: { siteId: true } }))?.siteId ?? null;
      case ChangeEntityType.SUBNET: return (await this.prisma.subnet.findUnique({ where: { id: entityId }, select: { siteId: true } }))?.siteId ?? null;
      case ChangeEntityType.IP_ADDRESS: return (await this.prisma.ipAddress.findUnique({ where: { id: entityId }, select: { subnet: { select: { siteId: true } } } }))?.subnet.siteId ?? null;
      case ChangeEntityType.HOST: {
        const host = await this.prisma.host.findUnique({ where: { id: entityId }, select: { device: { select: { siteId: true } }, ipAddresses: { select: { subnet: { select: { siteId: true } } } } } });
        return host?.device?.siteId ?? host?.ipAddresses.find((ip) => ip.subnet.siteId)?.subnet.siteId ?? null;
      }
      case ChangeEntityType.SERVICE: {
        const service = await this.prisma.service.findUnique({ where: { id: entityId }, select: { host: { select: { device: { select: { siteId: true } }, ipAddresses: { select: { subnet: { select: { siteId: true } } } } } } } });
        return service?.host.device?.siteId ?? service?.host.ipAddresses.find((ip) => ip.subnet.siteId)?.subnet.siteId ?? null;
      }
    }
  }

  private async assertTarget(user: AuthenticatedUser, entityType: ChangeEntityType, entityId: string, siteId: string, action: 'READ' | 'UPDATE') {
    const actualSite = await this.targetSite(entityType, entityId);
    if (!actualSite || actualSite !== siteId) throw new NotFoundException({ code: 'CHANGE_TARGET_NOT_FOUND', message: 'O alvo não pertence ao Site desta alteração.' });
    switch (entityType) {
      case ChangeEntityType.DEVICE: await this.infrastructure.assertDevice(user, action, entityId); break;
      case ChangeEntityType.INTERFACE: await this.infrastructure.assertInterface(user, action, entityId); break;
      case ChangeEntityType.VLAN: await this.ipam.assertVlan(user, action, entityId); break;
      case ChangeEntityType.SUBNET: await this.ipam.assertSubnet(user, action, entityId); break;
      case ChangeEntityType.IP_ADDRESS: await this.ipam.assertIp(user, action, entityId); break;
      case ChangeEntityType.HOST: await this.ipam.assertHost(user, action, entityId); break;
      case ChangeEntityType.SERVICE: {
        const service = await this.prisma.service.findUnique({ where: { id: entityId }, select: { hostId: true } });
        if (!service) throw new NotFoundException('Serviço não encontrado.');
        await this.ipam.assertHost(user, action, service.hostId); break;
      }
    }
  }

  private async validateItems(user: AuthenticatedUser, siteId: string, items: ChangePlanItemDto[]) {
    const unique = new Set<string>();
    for (const item of items) {
      const key = `${item.entityType}:${item.entityId}`;
      if (unique.has(key)) throw new BadRequestException({ code: 'CHANGE_TARGET_DUPLICATE', message: 'Cada alvo só pode aparecer uma vez.' });
      unique.add(key); await this.assertTarget(user, item.entityType, item.entityId, siteId, 'UPDATE');
    }
  }

  async candidates(user: AuthenticatedUser, siteId: string, rawQuery?: string, rawType?: string) {
    this.requireRole(user, VIEWERS); await this.assertSite(user, siteId, 'READ');
    const q = rawQuery?.trim().slice(0, 120) || undefined;
    const type = rawType ? (Object.values(ChangeEntityType) as string[]).includes(rawType) ? rawType as ChangeEntityType : (() => { throw new BadRequestException({ code: 'CHANGE_FILTER_INVALID', message: 'Tipo de alvo inválido.' }); })() : undefined;
    const want = (entityType: ChangeEntityType) => !type || type === entityType;
    const c = q ? { contains: q, mode: 'insensitive' as const } : undefined;
    const vlanNumber = q && /^\d{1,4}$/.test(q) ? Number(q) : undefined;
    const none = Promise.resolve([] as never[]);
    const [devices, interfaces, vlans, subnets, ips, hosts, services] = await Promise.all([
      want(ChangeEntityType.DEVICE) ? this.prisma.device.findMany({ where: { siteId, ...(c ? { name: c } : {}) }, select: { id: true, name: true, type: true, updatedAt: true }, take: IMPACT_LIMIT + 1 }) : none,
      want(ChangeEntityType.INTERFACE) ? this.prisma.deviceInterface.findMany({ where: { device: { siteId }, ...(c ? { OR: [{ name: c }, { device: { name: c } }] } : {}) }, select: { id: true, name: true, deviceId: true, device: { select: { name: true } } }, take: IMPACT_LIMIT + 1 }) : none,
      want(ChangeEntityType.VLAN) ? this.prisma.vlan.findMany({ where: { siteId, ...(c ? { OR: [{ name: c }, ...(vlanNumber !== undefined ? [{ vlanId: vlanNumber }] : [])] } : {}) }, select: { id: true, name: true, vlanId: true }, take: IMPACT_LIMIT + 1 }) : none,
      want(ChangeEntityType.SUBNET) ? this.prisma.subnet.findMany({ where: { siteId, ...(c ? { OR: [{ cidr: c }, { purpose: c }] } : {}) }, select: { id: true, cidr: true, purpose: true }, take: IMPACT_LIMIT + 1 }) : none,
      want(ChangeEntityType.IP_ADDRESS) ? this.prisma.ipAddress.findMany({ where: { subnet: { siteId }, ...(c ? { address: c } : {}) }, select: { id: true, address: true, state: true, subnet: { select: { cidr: true } } }, take: IMPACT_LIMIT + 1 }) : none,
      want(ChangeEntityType.HOST) ? this.prisma.host.findMany({ where: { OR: [{ device: { siteId } }, { ipAddresses: { some: { subnet: { siteId } } } }], ...(c ? { name: c } : {}) }, select: { id: true, name: true }, take: IMPACT_LIMIT + 1 }) : none,
      want(ChangeEntityType.SERVICE) ? this.prisma.service.findMany({ where: { host: { OR: [{ device: { siteId } }, { ipAddresses: { some: { subnet: { siteId } } } }] }, ...(c ? { OR: [{ name: c }, { host: { name: c } }] } : {}) }, select: { id: true, name: true, port: true, host: { select: { name: true } } }, take: IMPACT_LIMIT + 1 }) : none,
    ]);
    const groups: { entityType: ChangeEntityType; entityId: string; label: string; detail?: string }[][] = [
      devices.map((x) => ({ entityType: ChangeEntityType.DEVICE, entityId: x.id, label: x.name, detail: x.type })),
      interfaces.map((x) => ({ entityType: ChangeEntityType.INTERFACE, entityId: x.id, label: `${x.device?.name ?? 'Equipamento'} · ${x.name}`, detail: 'Interface' })),
      vlans.map((x) => ({ entityType: ChangeEntityType.VLAN, entityId: x.id, label: `VLAN ${x.vlanId} · ${x.name}` })),
      subnets.map((x) => ({ entityType: ChangeEntityType.SUBNET, entityId: x.id, label: x.cidr, detail: x.purpose ?? undefined })),
      ips.map((x) => ({ entityType: ChangeEntityType.IP_ADDRESS, entityId: x.id, label: x.address, detail: `${x.subnet.cidr} · ${x.state}` })),
      hosts.map((x) => ({ entityType: ChangeEntityType.HOST, entityId: x.id, label: x.name })),
      services.map((x) => ({ entityType: ChangeEntityType.SERVICE, entityId: x.id, label: x.name, detail: `${x.host.name}${x.port ? ` · ${x.port}` : ''}` })),
    ];
    const visible: typeof groups = [];
    for (const group of groups) {
      const allowed = await Promise.all(group.map(async (item) => { try { await this.assertTarget(user, item.entityType, item.entityId, siteId, 'READ'); return item; } catch (error) { if (this.isVisibilityFailure(error)) return null; throw error; } }));
      visible.push(allowed.filter((item): item is NonNullable<typeof item> => item !== null));
    }
    return { groups: visible, truncated: groups.some((group) => group.length > IMPACT_LIMIT) };
  }

  private parseStatuses(raw?: string) {
    if (!raw) return undefined;
    const values = raw.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
    const allowed = Object.values(ChangePlanStatus) as string[];
    if (!values.length || values.some((item) => !allowed.includes(item))) throw new BadRequestException({ code: 'CHANGE_FILTER_INVALID', message: `status tem de ser um ou mais de ${allowed.join(', ')}.` });
    return values as ChangePlanStatus[];
  }
  private parseRange(from?: string, to?: string, required = false) {
    const parse = (value: string | undefined, name: string) => {
      if (!value) return undefined;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new BadRequestException({ code: 'CHANGE_FILTER_INVALID', message: `Data inválida em ${name}.` });
      return date;
    };
    const start = parse(from, 'from'); const end = parse(to, 'to');
    if (required && (!start || !end)) throw new BadRequestException({ code: 'CHANGE_FILTER_INVALID', message: 'Indica from e to.' });
    if (start && end && end <= start) throw new BadRequestException({ code: 'CHANGE_FILTER_INVALID', message: 'to tem de ser posterior a from.' });
    return { start, end };
  }
  /** Prisma filter for plans whose window intersects [start, end). */
  private windowWhere(start?: Date, end?: Date): Prisma.ChangePlanWhereInput {
    return { ...(end ? { plannedStartAt: { lt: end } } : {}), ...(start ? { plannedEndAt: { gt: start } } : {}) };
  }

  async list(user: AuthenticatedUser, siteId: string, filters: ChangePlanListFilters = {}) {
    this.requireRole(user, VIEWERS); await this.assertSite(user, siteId, 'READ');
    const statuses = this.parseStatuses(filters.status); const { start, end } = this.parseRange(filters.from, filters.to);
    const q = filters.q?.trim().slice(0, 120) || undefined;
    const where: Prisma.ChangePlanWhereInput = { siteId, ...(statuses ? { status: { in: statuses } } : {}), ...this.windowWhere(start, end), ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { reason: { contains: q, mode: 'insensitive' } }, { items: { some: { operationSummary: { contains: q, mode: 'insensitive' } } } }] } : {}) };
    const plans = await this.prisma.changePlan.findMany({ where, include: { items: true, creator: { select: { id: true, username: true, displayName: true } }, reviewer: { select: { id: true, username: true, displayName: true } } }, orderBy: [{ plannedStartAt: 'desc' }, { createdAt: 'desc' }] });
    return Promise.all(plans.map((plan) => this.get(user, plan.id)));
  }

  /** Plan counts per status for the status tabs, plus what is running now and what is coming up. */
  async summary(user: AuthenticatedUser, siteId: string) {
    this.requireRole(user, VIEWERS); await this.assertSite(user, siteId, 'READ');
    const now = new Date();
    const [groups, inProgress, upcoming] = await Promise.all([
      this.prisma.changePlan.groupBy({ by: ['status'], where: { siteId }, _count: { _all: true } }),
      this.prisma.changePlan.count({ where: { siteId, status: ChangePlanStatus.APPROVED, plannedStartAt: { lte: now }, plannedEndAt: { gt: now } } }),
      this.prisma.changePlan.count({ where: { siteId, status: { in: ACTIVE_CONFLICT_STATUSES }, plannedStartAt: { gt: now } } }),
    ]);
    const byStatus = Object.fromEntries((Object.values(ChangePlanStatus) as string[]).map((status) => [status, groups.find((item) => item.status === status)?._count._all ?? 0]));
    return { siteId, total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus, inProgress, upcoming, generatedAt: now.toISOString() };
  }

  /**
   * Change plans and maintenance windows that intersect [from, to), with overlaps computed
   * server-side. Cancelled plans are left out unless includeCancelled is set.
   */
  async calendar(user: AuthenticatedUser, siteId: string, from?: string, to?: string, includeCancelled = false) {
    this.requireRole(user, VIEWERS); await this.assertSite(user, siteId, 'READ');
    const { start, end } = this.parseRange(from, to, true) as { start: Date; end: Date };
    if (end.getTime() - start.getTime() > CALENDAR_MAX_DAYS * DAY) throw new BadRequestException({ code: 'CHANGE_FILTER_INVALID', message: `O intervalo do calendário não pode exceder ${CALENDAR_MAX_DAYS} dias.` });
    const [plans, windows] = await Promise.all([
      this.prisma.changePlan.findMany({ where: { siteId, ...(includeCancelled ? {} : { status: { not: ChangePlanStatus.CANCELLED } }), ...this.windowWhere(start, end) }, orderBy: [{ plannedStartAt: 'asc' }, { id: 'asc' }], take: CALENDAR_LIMIT + 1, select: { id: true, title: true, status: true, plannedStartAt: true, plannedEndAt: true, revision: true, creator: { select: { id: true, username: true, displayName: true } }, items: { select: { entityType: true, entityId: true } } } }),
      this.prisma.maintenanceWindow.findMany({ where: { OR: [{ siteId }, { siteId: null }], startsAt: { lt: end }, endsAt: { gt: start } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: CALENDAR_LIMIT + 1, select: { id: true, name: true, reason: true, siteId: true, startsAt: true, endsAt: true } }),
    ]);
    // Shared targets are counted only over targets this user may read, so hidden records are never hinted at.
    const readable = new Map<string, boolean>();
    const canRead = async (entityType: ChangeEntityType, entityId: string) => {
      const key = `${entityType}:${entityId}`;
      if (!readable.has(key)) { try { await this.assertTarget(user, entityType, entityId, siteId, 'READ'); readable.set(key, true); } catch (error) { if (!this.isVisibilityFailure(error)) throw error; readable.set(key, false); } }
      return readable.get(key)!;
    };
    const planWindows = await Promise.all(plans.slice(0, CALENDAR_LIMIT).map(async (plan) => {
      const keys = new Set<string>();
      for (const item of plan.items) if (await canRead(item.entityType, item.entityId)) keys.add(`${item.entityType}:${item.entityId}`);
      return { plan, keys };
    }));
    const overlaps = computeOverlaps([
      ...planWindows.map(({ plan, keys }) => ({ kind: 'CHANGE_PLAN' as const, id: plan.id, startsAt: plan.plannedStartAt, endsAt: plan.plannedEndAt, active: (ACTIVE_CONFLICT_STATUSES as ChangePlanStatus[]).includes(plan.status), targetKeys: keys })),
      ...windows.slice(0, CALENDAR_LIMIT).map((item) => ({ kind: 'MAINTENANCE_WINDOW' as const, id: item.id, startsAt: item.startsAt, endsAt: item.endsAt, active: true })),
    ]);
    return {
      siteId, from: start.toISOString(), to: end.toISOString(),
      changePlans: planWindows.map(({ plan, keys }) => ({ id: plan.id, title: plan.title, status: plan.status, plannedStartAt: plan.plannedStartAt, plannedEndAt: plan.plannedEndAt, revision: plan.revision, creator: plan.creator, targetCount: keys.size, ...overlaps.get(`CHANGE_PLAN:${plan.id}`)! })),
      maintenanceWindows: windows.slice(0, CALENDAR_LIMIT).map((item) => ({ ...item, global: item.siteId === null, ...overlaps.get(`MAINTENANCE_WINDOW:${item.id}`)! })),
      truncated: plans.length > CALENDAR_LIMIT || windows.length > CALENDAR_LIMIT,
    };
  }

  /** Who did what to a plan, oldest first, from the audit log. Only events recorded for this plan are returned. */
  async activity(user: AuthenticatedUser, id: string) {
    this.requireRole(user, VIEWERS);
    const plan = await this.prisma.changePlan.findUnique({ where: { id }, select: { id: true, siteId: true } });
    if (!plan) throw new NotFoundException({ code: 'CHANGE_PLAN_NOT_FOUND', message: 'Alteração não encontrada.' });
    await this.assertSite(user, plan.siteId, 'READ');
    const events = await this.prisma.auditLog.findMany({ where: { entityType: 'ChangePlan', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500, include: { user: { select: { id: true, username: true, displayName: true } } } });
    return {
      changePlanId: id,
      items: events.map((event) => {
        const metadata = (event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata : {}) as Record<string, unknown>;
        return { id: event.id, action: event.action, at: event.createdAt, actor: event.user, revision: typeof metadata.revision === 'number' ? metadata.revision : null, note: typeof metadata.note === 'string' && metadata.note ? metadata.note : null, knownImpactCount: typeof metadata.knownImpactCount === 'number' ? metadata.knownImpactCount : null, coverage: typeof metadata.coverage === 'string' ? metadata.coverage : null, itemCount: typeof metadata.itemCount === 'number' ? metadata.itemCount : null };
      }),
      truncated: events.length >= 500,
    };
  }

  async get(user: AuthenticatedUser, id: string) {
    this.requireRole(user, VIEWERS);
    const plan = await this.prisma.changePlan.findUnique({ where: { id }, include: { items: true, creator: { select: { id: true, username: true, displayName: true } }, reviewer: { select: { id: true, username: true, displayName: true } } } });
    if (!plan) throw new NotFoundException({ code: 'CHANGE_PLAN_NOT_FOUND', message: 'Alteração não encontrada.' });
    await this.assertSite(user, plan.siteId, 'READ');
    const visibleItems = await Promise.all(plan.items.map(async (item) => { try { await this.assertTarget(user, item.entityType, item.entityId, plan.siteId, 'READ'); return item; } catch (error) { if (this.isVisibilityFailure(error)) return null; throw error; } }));
    const safeItems = visibleItems.filter((item) => item !== null);
    if (plan.previewSnapshot && typeof plan.previewSnapshot === 'object') {
      const snapshot = plan.previewSnapshot as any;
      const allowed = await Promise.all((snapshot.knownImpacts ?? []).map(async (node: any) => { try { await this.assertTarget(user, node.entityType, node.entityId, plan.siteId, 'READ'); return node; } catch (error) { if (this.isVisibilityFailure(error)) return null; throw error; } }));
      const knownImpacts = allowed.filter(Boolean);
      const hidden = safeItems.length !== plan.items.length || knownImpacts.length !== (snapshot.knownImpacts ?? []).length;
      const visibleKeys = new Set([...safeItems.map((item) => `${item.entityType}:${item.entityId}`), ...knownImpacts.map((node: any) => `${node.entityType}:${node.entityId}`)]);
      const safeSnapshot = { ...snapshot, knownImpacts, dependencyEdges: (snapshot.dependencyEdges ?? []).filter((edge: any) => visibleKeys.has(edge.from) && visibleKeys.has(edge.to)), coverage: hidden ? { ...snapshot.coverage, status: 'PARTIAL', reason: 'Alguns alvos ou dependências estão fora do teu âmbito de acesso.' } : snapshot.coverage };
      return { ...plan, items: safeItems, previewSnapshot: safeSnapshot };
    }
    return { ...plan, items: safeItems };
  }

  private async graph(siteId: string, roots: { entityType: ChangeEntityType; entityId: string }[]) {
    const [devices, vlans, subnets, connections] = await Promise.all([
      this.prisma.device.findMany({ where: { siteId }, include: { interfaces: { include: { allowedVlans: true } }, ipAddresses: true, host: { include: { services: true, ipAddresses: true } } }, take: IMPACT_LIMIT + 1 }),
      this.prisma.vlan.findMany({ where: { siteId }, select: { id: true, vlanId: true, name: true }, take: IMPACT_LIMIT + 1 }),
      this.prisma.subnet.findMany({ where: { siteId }, include: { ips: { include: { device: true, interface: { include: { device: true } }, host: { include: { services: true } } } } }, take: IMPACT_LIMIT + 1 }),
      this.prisma.deviceConnection.findMany({ where: { siteId }, include: { sourceInterface: true, targetInterface: true }, take: IMPACT_LIMIT + 1 }),
    ]);
    const nodes = new Map<string, GraphNode>(); const edges: GraphEdge[] = [];
    const keyOf = (type: ChangeEntityType, id: string) => `${type}:${id}`;
    const put = (node: GraphNode) => nodes.set(node.key, node);
    const link = (from: string, to: string, relationship: string, source = 'INVENTORY', updatedAt?: Date) => { if (nodes.has(from) && nodes.has(to)) { const confidence = source === 'SNMP' ? 'LOW' : 'RECORDED'; edges.push({ from, to, relationship, source, confidence, updatedAt }); edges.push({ from: to, to: from, relationship, source, confidence, updatedAt }); } };
    const deviceMap = new Map(devices.map((d) => [d.id, d]));
    const vlanIds = new Set(vlans.map((v) => v.id));
    const deviceNode = (d: any) => put({ key: keyOf(ChangeEntityType.DEVICE, d.id), entityType: ChangeEntityType.DEVICE, entityId: d.id, label: d.name, href: `/infraestrutura?siteId=${siteId}&tab=devices&deviceId=${d.id}&focus=device`, siteId, updatedAt: d.updatedAt, source: d.source });
    const interfaceNode = (i: any, name: string) => put({ key: keyOf(ChangeEntityType.INTERFACE, i.id), entityType: ChangeEntityType.INTERFACE, entityId: i.id, label: `${name} · ${i.name}`, href: `/infraestrutura?siteId=${siteId}&tab=interfaces&deviceId=${i.deviceId}&interfaceId=${i.id}`, siteId, observedAt: i.lastSeenAt, source: i.source });
    const vlanNode = (v: any) => put({ key: keyOf(ChangeEntityType.VLAN, v.id), entityType: ChangeEntityType.VLAN, entityId: v.id, label: `VLAN ${v.vlanId} · ${v.name}`, href: `/ipam?siteId=${siteId}&vlanId=${v.id}`, siteId, updatedAt: v.updatedAt });
    const subnetNode = (s: any) => put({ key: keyOf(ChangeEntityType.SUBNET, s.id), entityType: ChangeEntityType.SUBNET, entityId: s.id, label: s.cidr, href: `/ipam?siteId=${siteId}&subnetId=${s.id}`, siteId, updatedAt: s.updatedAt });
    const ipNode = (ip: any) => put({ key: keyOf(ChangeEntityType.IP_ADDRESS, ip.id), entityType: ChangeEntityType.IP_ADDRESS, entityId: ip.id, label: `${ip.address} · ${ip.state}`, href: `/ipam?siteId=${siteId}&subnetId=${ip.subnetId}&ipId=${ip.id}`, siteId, observedAt: ip.lastSeenAt, source: ip.source });
    const hostNode = (h: any) => put({ key: keyOf(ChangeEntityType.HOST, h.id), entityType: ChangeEntityType.HOST, entityId: h.id, label: h.name, href: `/ipam?siteId=${siteId}&hostId=${h.id}`, siteId, updatedAt: h.updatedAt, observedAt: h.lastSeenAt, source: h.source });
    const serviceNode = (s: any, hostName: string) => put({ key: keyOf(ChangeEntityType.SERVICE, s.id), entityType: ChangeEntityType.SERVICE, entityId: s.id, label: `${s.name}${s.port ? ` · ${s.port}` : ''} · ${hostName}`, href: `/ipam?siteId=${siteId}&serviceId=${s.id}`, siteId, updatedAt: s.updatedAt, observedAt: s.lastSeenAt, source: s.source });
    for (const device of devices) {
      deviceNode(device);
      for (const intf of device.interfaces) interfaceNode(intf, device.name);
      for (const ip of device.ipAddresses) ipNode(ip);
      if (device.host) { hostNode(device.host); for (const svc of device.host.services) serviceNode(svc, device.host.name); for (const ip of device.host.ipAddresses) ipNode(ip); }
    }
    for (const vlan of vlans) vlanNode(vlan);
    for (const subnet of subnets) {
      subnetNode(subnet);
      for (const ip of subnet.ips) { ipNode(ip); if (ip.host) { hostNode(ip.host); for (const svc of ip.host.services) serviceNode(svc, ip.host.name); } if (ip.device && deviceMap.has(ip.device.id)) deviceNode(ip.device); if (ip.interface?.device && deviceMap.has(ip.interface.device.id)) { deviceNode(ip.interface.device); interfaceNode(ip.interface, ip.interface.device.name); } }
    }
    for (const device of devices) {
      for (const intf of device.interfaces) {
        link(keyOf(ChangeEntityType.DEVICE, device.id), keyOf(ChangeEntityType.INTERFACE, intf.id), 'Interface');
        const vlanList = [intf.nativeVlanId, intf.accessVlanId, ...intf.allowedVlans.map((entry) => entry.vlanId)].filter((id): id is string => Boolean(id && vlanIds.has(id)));
        for (const vlanId of new Set(vlanList)) link(keyOf(ChangeEntityType.INTERFACE, intf.id), keyOf(ChangeEntityType.VLAN, vlanId), 'VLAN membership');
      }
      for (const ip of device.ipAddresses) link(keyOf(ChangeEntityType.DEVICE, device.id), keyOf(ChangeEntityType.IP_ADDRESS, ip.id), 'Management address');
      if (device.host) { link(keyOf(ChangeEntityType.DEVICE, device.id), keyOf(ChangeEntityType.HOST, device.host.id), 'Host association'); for (const svc of device.host.services) link(keyOf(ChangeEntityType.HOST, device.host.id), keyOf(ChangeEntityType.SERVICE, svc.id), 'Hosts service'); for (const ip of device.host.ipAddresses) link(keyOf(ChangeEntityType.HOST, device.host.id), keyOf(ChangeEntityType.IP_ADDRESS, ip.id), 'Host address'); }
    }
    for (const subnet of subnets) {
      if (subnet.vlanId && vlanIds.has(subnet.vlanId)) link(keyOf(ChangeEntityType.SUBNET, subnet.id), keyOf(ChangeEntityType.VLAN, subnet.vlanId), 'Belongs to VLAN');
      for (const ip of subnet.ips) {
        link(keyOf(ChangeEntityType.SUBNET, subnet.id), keyOf(ChangeEntityType.IP_ADDRESS, ip.id), 'Address in subnet');
        if (ip.device && deviceMap.has(ip.device.id)) link(keyOf(ChangeEntityType.IP_ADDRESS, ip.id), keyOf(ChangeEntityType.DEVICE, ip.device.id), 'Assigned to device');
        if (ip.interface?.device && deviceMap.has(ip.interface.device.id)) link(keyOf(ChangeEntityType.IP_ADDRESS, ip.id), keyOf(ChangeEntityType.INTERFACE, ip.interface.id), 'Assigned to interface');
        if (ip.host) { link(keyOf(ChangeEntityType.IP_ADDRESS, ip.id), keyOf(ChangeEntityType.HOST, ip.host.id), 'Assigned to host'); for (const svc of ip.host.services) link(keyOf(ChangeEntityType.HOST, ip.host.id), keyOf(ChangeEntityType.SERVICE, svc.id), 'Hosts service'); }
      }
    }
    for (const connection of connections) {
      const from = keyOf(ChangeEntityType.DEVICE, connection.sourceDeviceId); const to = keyOf(ChangeEntityType.DEVICE, connection.targetDeviceId);
      link(from, to, connection.label || connection.type, connection.source, connection.updatedAt); link(to, from, connection.label || connection.type, connection.source, connection.updatedAt);
      if (connection.sourceInterfaceId && nodes.has(keyOf(ChangeEntityType.INTERFACE, connection.sourceInterfaceId))) { link(from, keyOf(ChangeEntityType.INTERFACE, connection.sourceInterfaceId), 'Connection endpoint', connection.source, connection.updatedAt); link(keyOf(ChangeEntityType.INTERFACE, connection.sourceInterfaceId), to, connection.label || connection.type, connection.source, connection.updatedAt); }
      if (connection.targetInterfaceId && nodes.has(keyOf(ChangeEntityType.INTERFACE, connection.targetInterfaceId))) { link(to, keyOf(ChangeEntityType.INTERFACE, connection.targetInterfaceId), 'Connection endpoint', connection.source, connection.updatedAt); link(keyOf(ChangeEntityType.INTERFACE, connection.targetInterfaceId), from, connection.label || connection.type, connection.source, connection.updatedAt); }
    }
    const uniqueEdges = [...new Map(edges.map((edge) => [`${edge.from}>${edge.to}:${edge.relationship}`, edge])).values()];
    const rootKeys = roots.map((root) => keyOf(root.entityType, root.entityId));
    const maxed = devices.length > IMPACT_LIMIT || vlans.length > IMPACT_LIMIT || subnets.length > IMPACT_LIMIT || connections.length > IMPACT_LIMIT;
    return { nodes, edges: uniqueEdges, rootKeys, maxed };
  }

  private async previewSnapshot(user: AuthenticatedUser, plan: any, targetAction: 'READ' | 'UPDATE') {
    await Promise.all(plan.items.map((item: any) => this.assertTarget(user, item.entityType, item.entityId, plan.siteId, targetAction)));
    const graph = await this.graph(plan.siteId, plan.items); const now = new Date();
    type PathState = { key: string; depth: number; dependencyPath: string[]; confidence: 'RECORDED' | 'LOW'; edgePath: GraphEdge[] };
    const reachable = new Map<string, Omit<PathState, 'key'>>();
    const queue: PathState[] = graph.rootKeys.map((key) => ({ key, depth: 0, dependencyPath: [], confidence: 'RECORDED', edgePath: [] }));
    const roots = new Set(graph.rootKeys);
    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth >= 3) continue;
      for (const edge of graph.edges.filter((item) => item.from === current.key)) {
        if (roots.has(edge.to) || reachable.has(edge.to)) continue;
        const next = { depth: current.depth + 1, dependencyPath: [...current.dependencyPath, edge.relationship], confidence: current.confidence === 'LOW' || edge.confidence === 'LOW' ? 'LOW' as const : 'RECORDED' as const, edgePath: [...current.edgePath, edge] };
        reachable.set(edge.to, next); queue.push({ key: edge.to, ...next });
        if (reachable.size >= IMPACT_LIMIT) break;
      }
      if (reachable.size >= IMPACT_LIMIT) break;
    }
    const visible = new Set<string>(); let hiddenCount = 0;
    await Promise.all([...reachable.keys(), ...graph.rootKeys].map(async (key) => {
      const node = graph.nodes.get(key); if (!node) { hiddenCount++; return; }
      try { await this.assertTarget(user, node.entityType, node.entityId, plan.siteId, 'READ'); visible.add(key); } catch (error) { if (this.isVisibilityFailure(error)) hiddenCount++; else throw error; }
    }));
    const allNodes = [...visible].map((key) => graph.nodes.get(key)!).filter(Boolean);
    const knownImpacts: ImpactEntry[] = [...reachable.entries()].filter(([key]) => visible.has(key)).map(([key, route]) => {
      const node = graph.nodes.get(key)!; const ageHours = node.observedAt ? (now.getTime() - node.observedAt.getTime()) / 3_600_000 : null;
      const freshness = ageHours === null ? 'UNKNOWN' : ageHours > 24 ? 'STALE' : 'CURRENT';
      return { ...node, ...route, freshness };
    }).sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label));
    // Only edges used by the selected root-to-impact paths affect coverage or the
    // preview signature. Unrelated Site edges must not make a plan incomplete or stale.
    const pathEdges = new Map<string, GraphEdge>();
    for (const route of reachable.values()) for (const edge of route.edgePath) pathEdges.set(`${edge.from}>${edge.to}:${edge.relationship}`, edge);
    const visibleEdges = [...pathEdges.values()].filter((edge) => visible.has(edge.from) && visible.has(edge.to));
    const windows = await this.prisma.maintenanceWindow.findMany({ where: { AND: [{ OR: [{ siteId: plan.siteId }, { siteId: null }] }, { startsAt: { lt: plan.plannedEndAt } }, { endsAt: { gt: plan.plannedStartAt } }] }, orderBy: { startsAt: 'asc' }, take: 100, select: { id: true, name: true, reason: true, siteId: true, startsAt: true, endsAt: true } });
    const overlappingPlans = await this.prisma.changePlan.findMany({ where: { siteId: plan.siteId, id: { not: plan.id }, status: { in: ACTIVE_CONFLICT_STATUSES }, plannedStartAt: { lt: plan.plannedEndAt }, plannedEndAt: { gt: plan.plannedStartAt } }, select: { id: true, title: true, plannedStartAt: true, plannedEndAt: true, status: true }, take: 100 });
    const capped = graph.maxed || reachable.size >= IMPACT_LIMIT || windows.length >= 100 || overlappingPlans.length >= 100;
    const staleItems = knownImpacts.filter((entry) => entry.freshness === 'STALE').length;
    const lowConfidence = visibleEdges.some((edge) => edge.confidence === 'LOW');
    const status = hiddenCount || capped || staleItems || lowConfidence ? 'PARTIAL' : 'COMPLETE';
    const coverageReason = hiddenCount ? 'Algumas relações ou equipamentos não podem ser mostrados no teu âmbito de acesso.' : capped ? 'A análise atingiu o limite de resultados; os impactos podem estar incompletos.' : staleItems ? 'Há relações baseadas em observações com mais de 24 horas; atualiza o inventário e calcula novamente.' : lowConfidence ? 'Inclui ligações observadas por SNMP, com confiança baixa, além das relações registadas.' : knownImpacts.length ? 'Mostra as relações registadas no inventário. Relações não documentadas podem não aparecer.' : 'Não foram encontradas relações registadas; isto não garante ausência de impacto.';
    const graphSignature = this.hash({ nodes: allNodes.map(({ key, updatedAt, observedAt, source }) => [key, updatedAt?.toISOString() ?? null, observedAt?.toISOString() ?? null, source]).sort(), edges: visibleEdges.map(({ from, to, relationship, source, confidence, updatedAt }) => [from, to, relationship, source, confidence, updatedAt?.toISOString() ?? null]).sort(), roots: [...graph.rootKeys].sort(), maintenance: windows.map(({ id, startsAt, endsAt }) => [id, startsAt.toISOString(), endsAt.toISOString()]), overlappingPlans: overlappingPlans.map(({ id, status, plannedStartAt, plannedEndAt }) => [id, status, plannedStartAt.toISOString(), plannedEndAt.toISOString()]) });
    return {
      analysisStatus: 'COMPLETE',
      revision: plan.revision,
      generatedAt: now.toISOString(),
      siteId: plan.siteId,
      scope: { title: plan.title, plannedStartAt: plan.plannedStartAt.toISOString(), plannedEndAt: plan.plannedEndAt.toISOString(), targets: plan.items.length },
      knownImpacts,
      dependencyEdges: visibleEdges,
      maintenanceOverlaps: windows,
      changeOverlaps: overlappingPlans,
      coverage: { status, reason: coverageReason, relationshipSources: [...new Set(visibleEdges.map((edge) => edge.source))], latestInventoryUpdate: allNodes.map((node) => node.updatedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0]?.toISOString() ?? null, staleItems, unknownFreshnessItems: knownImpacts.filter((entry) => entry.freshness === 'UNKNOWN').length },
      graphSignature,
    };
  }

  async create(user: AuthenticatedUser, dto: CreateChangePlanDto) {
    this.requireRole(user, CREATORS); this.assertWindow(dto.plannedStartAt, dto.plannedEndAt); await this.assertSite(user, dto.siteId, 'CREATE'); await this.validateItems(user, dto.siteId, dto.items);
    const plan = await this.prisma.changePlan.create({ data: { siteId: dto.siteId, title: dto.title.trim(), reason: dto.reason.trim(), plannedStartAt: new Date(dto.plannedStartAt), plannedEndAt: new Date(dto.plannedEndAt), createdById: user.id, items: { create: dto.items.map((item) => ({ entityType: item.entityType, entityId: item.entityId, operationSummary: item.operationSummary.trim(), currentValue: item.currentValue as Prisma.InputJsonValue | undefined, proposedValue: item.proposedValue as Prisma.InputJsonValue | undefined })) } }, include: { items: true } });
    await this.audit.record({ userId: user.id, action: 'CHANGE_PLAN_CREATED', entityType: 'ChangePlan', entityId: plan.id, metadata: { siteId: plan.siteId, revision: plan.revision, itemCount: plan.items.length } });
    return plan;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateChangePlanDto) {
    this.requireRole(user, CREATORS);
    const existing = await this.prisma.changePlan.findUnique({ where: { id }, include: { items: true } }); if (!existing) throw new NotFoundException('Alteração não encontrada.');
    await this.assertSite(user, existing.siteId, 'UPDATE');
    if (!this.isStatus(existing.status, ChangePlanStatus.DRAFT, ChangePlanStatus.REJECTED)) throw new ConflictException({ code: 'CHANGE_PLAN_NOT_EDITABLE', message: 'Só podes editar alterações em rascunho ou devolvidas para correção.' });
    if (dto.expectedRevision !== undefined && dto.expectedRevision !== existing.revision) throw new ConflictException({ code: 'CHANGE_PLAN_REVISION_CONFLICT', message: 'A alteração foi atualizada noutro local. Atualiza a página antes de editar.' });
    const start = dto.plannedStartAt ?? existing.plannedStartAt; const end = dto.plannedEndAt ?? existing.plannedEndAt; this.assertWindow(start, end);
    const items = dto.items ?? existing.items;
    if (dto.items) await this.validateItems(user, existing.siteId, dto.items);
    const data = { title: dto.title?.trim(), reason: dto.reason?.trim(), plannedStartAt: new Date(start), plannedEndAt: new Date(end), revision: { increment: 1 }, previewRevision: null, previewSnapshot: Prisma.DbNull, previewedAt: null, status: ChangePlanStatus.DRAFT, submittedAt: null, reviewerId: null, reviewedAt: null, reviewNote: null };
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.changePlan.updateMany({ where: { id, revision: existing.revision, status: existing.status }, data });
      if (changed.count !== 1) throw new ConflictException({ code: 'CHANGE_PLAN_REVISION_CONFLICT', message: 'A alteração foi atualizada noutro local. Atualiza a página antes de editar.' });
      if (dto.items) { await tx.changePlanItem.deleteMany({ where: { changePlanId: id } }); await tx.changePlanItem.createMany({ data: dto.items.map((item) => ({ changePlanId: id, entityType: item.entityType, entityId: item.entityId, operationSummary: item.operationSummary.trim(), currentValue: item.currentValue as Prisma.InputJsonValue | undefined, proposedValue: item.proposedValue as Prisma.InputJsonValue | undefined })) }); }
      return tx.changePlan.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
    await this.audit.record({ userId: user.id, action: 'CHANGE_PLAN_UPDATED', entityType: 'ChangePlan', entityId: id, metadata: { siteId: existing.siteId, revision: updated.revision } }); return updated;
  }

  async preview(user: AuthenticatedUser, id: string) {
    this.requireRole(user, [...CREATORS, 'AUDITOR', 'READ_ONLY']);
    const plan = await this.prisma.changePlan.findUnique({ where: { id }, include: { items: true } }); if (!plan) throw new NotFoundException('Alteração não encontrada.');
    await this.assertSite(user, plan.siteId, 'READ');
    if (!this.isStatus(plan.status, ChangePlanStatus.DRAFT, ChangePlanStatus.REJECTED)) throw new ConflictException({ code: 'CHANGE_PLAN_NOT_PREVIEWABLE', message: 'A pré-visualização só pode ser recalculada antes da submissão.' });
    const snapshot = await this.previewSnapshot(user, plan, 'READ');
    await this.prisma.changePlan.update({ where: { id, revision: plan.revision }, data: { previewRevision: plan.revision, previewSnapshot: snapshot as Prisma.InputJsonValue, previewedAt: new Date(snapshot.generatedAt) } }).catch(() => { throw new ConflictException({ code: 'CHANGE_PLAN_REVISION_CONFLICT', message: 'A alteração mudou durante a análise. Atualiza e calcula novamente.' }); });
    await this.audit.record({ userId: user.id, action: 'CHANGE_PLAN_IMPACT_PREVIEWED', entityType: 'ChangePlan', entityId: id, metadata: { siteId: plan.siteId, revision: plan.revision, knownImpactCount: snapshot.knownImpacts.length, coverage: snapshot.coverage.status } });
    return snapshot;
  }

  async submit(user: AuthenticatedUser, id: string) {
    this.requireRole(user, CREATORS);
    const plan = await this.prisma.changePlan.findUnique({ where: { id }, include: { items: true } }); if (!plan) throw new NotFoundException('Alteração não encontrada.');
    await this.assertSite(user, plan.siteId, 'UPDATE');
    if (!this.isStatus(plan.status, ChangePlanStatus.DRAFT, ChangePlanStatus.REJECTED)) throw new ConflictException({ code: 'CHANGE_PLAN_NOT_SUBMITTABLE', message: 'Esta alteração já foi submetida ou encerrada.' });
    if (plan.previewRevision !== plan.revision || !plan.previewSnapshot) throw new ConflictException({ code: 'CHANGE_PLAN_PREVIEW_REQUIRED', message: 'Calcula uma pré-visualização atual antes de submeter.' });
    const latest = await this.previewSnapshot(user, plan, 'UPDATE'); const previous = plan.previewSnapshot as any;
    if (latest.coverage.status === 'PARTIAL') throw new ConflictException({ code: 'CHANGE_PLAN_PREVIEW_INCOMPLETE', message: 'A análise está incompleta. Resolve o âmbito ou o limite de resultados e calcula novamente antes de submeter.' });
    if (latest.graphSignature !== previous.graphSignature) throw new ConflictException({ code: 'CHANGE_PLAN_PREVIEW_STALE', message: 'O inventário ou as dependências mudaram desde a pré-visualização. Calcula novamente antes de submeter.' });
    const submitted = await this.prisma.changePlan.update({ where: { id, revision: plan.revision, previewRevision: plan.revision }, data: { status: ChangePlanStatus.SUBMITTED, submittedAt: new Date(), previewSnapshot: latest as Prisma.InputJsonValue }, include: { items: true } }).catch(() => { throw new ConflictException({ code: 'CHANGE_PLAN_REVISION_CONFLICT', message: 'A alteração mudou durante a submissão. Atualiza e tenta novamente.' }); });
    await this.audit.record({ userId: user.id, action: 'CHANGE_PLAN_SUBMITTED', entityType: 'ChangePlan', entityId: id, metadata: { siteId: plan.siteId, revision: plan.revision, knownImpactCount: latest.knownImpacts.length } });
    return submitted;
  }

  async review(user: AuthenticatedUser, id: string, dto: ReviewChangePlanDto) {
    this.requireRole(user, ['ADMIN']);
    const plan = await this.prisma.changePlan.findUnique({ where: { id } }); if (!plan) throw new NotFoundException('Alteração não encontrada.');
    await this.assertSite(user, plan.siteId, 'UPDATE');
    if (plan.status !== ChangePlanStatus.SUBMITTED) throw new ConflictException({ code: 'CHANGE_PLAN_NOT_REVIEWABLE', message: 'Só podes rever uma alteração submetida.' });
    if (dto.status === ChangePlanStatus.REJECTED && !dto.reviewNote?.trim()) throw new BadRequestException({ code: 'CHANGE_REJECTION_REASON_REQUIRED', message: 'Indica o motivo para devolver a alteração.' });
    const result = await this.prisma.changePlan.update({ where: { id, status: ChangePlanStatus.SUBMITTED }, data: { status: dto.status, reviewerId: user.id, reviewedAt: new Date(), reviewNote: dto.reviewNote?.trim() ?? null } });
    await this.audit.record({ userId: user.id, action: dto.status === ChangePlanStatus.APPROVED ? 'CHANGE_PLAN_APPROVED' : 'CHANGE_PLAN_REJECTED', entityType: 'ChangePlan', entityId: id, metadata: { siteId: plan.siteId, revision: plan.revision, note: dto.reviewNote?.trim() } }); return result;
  }

  async cancel(user: AuthenticatedUser, id: string) {
    this.requireRole(user, CREATORS);
    const plan = await this.prisma.changePlan.findUnique({ where: { id } }); if (!plan) throw new NotFoundException('Alteração não encontrada.');
    await this.assertSite(user, plan.siteId, 'UPDATE');
    if (!this.isStatus(plan.status, ChangePlanStatus.DRAFT, ChangePlanStatus.SUBMITTED, ChangePlanStatus.REJECTED)) throw new ConflictException({ code: 'CHANGE_PLAN_NOT_CANCELLABLE', message: 'Uma alteração aprovada ou cancelada não pode ser cancelada.' });
    const result = await this.prisma.changePlan.update({ where: { id, status: plan.status }, data: { status: ChangePlanStatus.CANCELLED } });
    await this.audit.record({ userId: user.id, action: 'CHANGE_PLAN_CANCELLED', entityType: 'ChangePlan', entityId: id, metadata: { siteId: plan.siteId, revision: plan.revision } }); return result;
  }
}
