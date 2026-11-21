import { portLayoutIncompleteMessage, portMappingStatus } from '../infrastructure/port-layout';
import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { AlertSeverityDto } from '../operations/dto';
import { OperationsService } from '../operations/operations.service';
import { AssignFindingDto, BulkFindingActionDto, FindingFacetsQueryDto, ListFindingsQueryDto, SNOOZE_MAX_HOURS, SNOOZE_MIN_HOURS, SnoozeFindingDto } from './dto';
/** Upper bound on findings scanned for the work-queue facets. */
export const FACET_SCAN_LIMIT = 20_000;

const HOUR = 60 * 60 * 1000;
const SNOOZE_CLOCK_GRACE_MS = 60 * 1000;
/** Resolves the snooze end from exactly one of `until` or `durationHours`, bounded to 1h–30d from `now`. */
export function resolveSnoozeUntil(input: { until?: string; durationHours?: number }, now = new Date()) {
  const hasUntil = input.until !== undefined && input.until !== null && input.until !== '';
  const hasDuration = input.durationHours !== undefined && input.durationHours !== null;
  if (hasUntil === hasDuration) throw new BadRequestException({ code: 'SNOOZE_DURATION_REQUIRED', message: 'Indica a data de fim (until) ou a duração em horas (durationHours), mas não ambas.' });
  if (hasDuration) {
    const hours = Number(input.durationHours);
    if (!Number.isInteger(hours) || hours < SNOOZE_MIN_HOURS || hours > SNOOZE_MAX_HOURS) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: `A duração do snooze tem de estar entre ${SNOOZE_MIN_HOURS} hora e ${SNOOZE_MAX_HOURS / 24} dias.` });
    return new Date(now.getTime() + hours * HOUR);
  }
  const until = new Date(input.until!);
  if (!Number.isFinite(until.getTime())) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: 'Data de snooze inválida.' });
  if (until <= now) throw new BadRequestException('A data de snooze tem de ser futura');
  const delta = until.getTime() - now.getTime();
  if (delta < SNOOZE_MIN_HOURS * HOUR - SNOOZE_CLOCK_GRACE_MS || delta > SNOOZE_MAX_HOURS * HOUR + SNOOZE_CLOCK_GRACE_MS) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: `A duração do snooze tem de estar entre ${SNOOZE_MIN_HOURS} hora e ${SNOOZE_MAX_HOURS / 24} dias.` });
  return until;
}

export type BulkItemResult = { id: string; ok: boolean; code?: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'ERROR'; message?: string; status?: string };
function bulkFailure(id: string, error: unknown): BulkItemResult {
  if (error instanceof NotFoundException) return { id, ok: false, code: 'NOT_FOUND', message: 'Finding não encontrado' };
  if (error instanceof ForbiddenException) return { id, ok: false, code: 'FORBIDDEN', message: error.message };
  if (error instanceof BadRequestException) return { id, ok: false, code: 'INVALID', message: error.message };
  if (error instanceof HttpException) return { id, ok: false, code: 'ERROR', message: error.message };
  throw error;
}

type Candidate = {
  dedupKey: string; siteId: string | null; rule: string; severity: AlertSeverityDto;
  entityType: string; entityId: string; title: string; detail: string; metadata?: Record<string, string | number | boolean | null>;
};

@Injectable()
export class InventoryQualityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: InfrastructureAccessService,
    private readonly ipamAccess: IpamAccessService,
    private readonly alerts: OperationsService,
    private readonly audit: AuditService,
  ) {}

  private async canSeeSite(user: AuthenticatedUser, siteId: string | null) {
    if (!siteId) return user.roles.includes('ADMIN');
    try { await this.access.assertSite(user, 'READ', siteId); return true; } catch { return false; }
  }
  private async visibleSiteIds(user: AuthenticatedUser) {
    if (user.roles.includes('ADMIN')) return (await this.prisma.site.findMany({ select: { id: true } })).map(({ id }) => id);
    const sites = await this.prisma.site.findMany({ select: { id: true } });
    const visible = await Promise.all(sites.map(async ({ id }) => await this.canSeeSite(user, id) ? id : null));
    return visible.filter((id): id is string => Boolean(id));
  }
  private async canOperateSite(user: AuthenticatedUser, siteId: string) {
    if (user.roles.includes('ADMIN')) return true;
    try {
      const effective = await this.access.effectiveAccess(user, siteId);
      return [effective.infrastructure.site, ...effective.infrastructure.buildings.map((item) => item.actions), ...effective.infrastructure.rooms.map((item) => item.actions)]
        .some((actions) => actions.some((action) => action === 'CREATE' || action === 'UPDATE' || action === 'DELETE'));
    } catch { return false; }
  }
  private async canSeeFinding(user: AuthenticatedUser, finding: { siteId: string | null; entityType: string; entityId: string }) {
    if (!finding.siteId) return user.roles.includes('ADMIN');
    if (!await this.canSeeSite(user, finding.siteId)) return false;
    if (user.roles.includes('ADMIN')) return true;
    try {
      if (finding.entityType === 'Device') await this.access.assertDevice(user, 'READ', finding.entityId);
      else if (finding.entityType === 'DeviceInterface') await this.access.assertInterface(user, 'READ', finding.entityId);
      else if (finding.entityType === 'SnmpDrift') {
        const drift = await this.prisma.snmpDrift.findUnique({ where: { id: finding.entityId }, select: { deviceId: true } });
        if (!drift) return false; await this.access.assertDevice(user, 'READ', drift.deviceId);
      } else if (finding.entityType === 'IpAddress') await this.ipamAccess.assertIp(user, 'READ', finding.entityId);
      else if (finding.entityType === 'DeviceModel') {
        const devices = await this.prisma.device.findMany({ where: { siteId: finding.siteId, modelId: finding.entityId }, select: { id: true } });
        for (const device of devices) { try { await this.access.assertDevice(user, 'READ', device.id); return true; } catch { /* try another device using this model */ } }
        return false;
      } else return false;
      return true;
    } catch { return false; }
  }
  private async filterVisibleFindings<T extends { siteId: string | null; entityType: string; entityId: string }>(user: AuthenticatedUser, items: T[]) {
    if (user.roles.includes('ADMIN')) return items;
    const visible: T[] = [];
    for (const item of items) if (await this.canSeeFinding(user, item)) visible.push(item);
    return visible;
  }
  private async mutable(user: AuthenticatedUser, id: string) {
    const finding = await this.prisma.inventoryFinding.findUnique({ where: { id } });
    if (!finding || !await this.canSeeFinding(user, finding)) throw new NotFoundException('Finding não encontrado');
    if (!finding.siteId && !user.roles.includes('ADMIN')) throw new ForbiddenException('Apenas ADMIN pode alterar findings globais');
    if (finding.siteId && !await this.canOperateSite(user, finding.siteId)) throw new ForbiddenException('Não tens permissão operacional neste Site');
    return finding;
  }

  private assigneeWhere(user: AuthenticatedUser, assignee?: string) {
    if (!assignee) return [];
    if (assignee === 'unassigned') return [{ assignedToId: null }];
    if (assignee === 'me') return [{ assignedToId: user.id }];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignee)) throw new BadRequestException({ code: 'FINDING_FILTER_INVALID', message: 'assignee tem de ser um id de utilizador, "me" ou "unassigned".' });
    return [{ assignedToId: assignee }];
  }

  /**
   * Counts for the work queue. Each dimension is counted with every other filter applied
   * but not its own, so a tab or dropdown shows how many items selecting it would give.
   */
  async facets(user: AuthenticatedUser, query: FindingFacetsQueryDto = {}) {
    const siteIds = await this.visibleSiteIds(user);
    if (query.siteId && !siteIds.includes(query.siteId)) throw new NotFoundException('Site não encontrado');
    const scope = query.siteId ? { siteId: query.siteId } : user.roles.includes('ADMIN') ? { OR: [{ siteId: null }, { siteId: { in: siteIds } }] } : { siteId: { in: siteIds } };
    const search = query.search ? [{ OR: [{ title: { contains: query.search, mode: 'insensitive' as const } }, { detail: { contains: query.search, mode: 'insensitive' as const } }] }] : [];
    // Bounded: per-finding visibility has to be checked in memory, so at most FACET_SCAN_LIMIT findings (most recent first) are counted.
    const scanned = await this.prisma.inventoryFinding.findMany({ where: { AND: [scope, ...search] }, orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }], take: FACET_SCAN_LIMIT + 1, select: { id: true, siteId: true, entityType: true, entityId: true, status: true, severity: true, rule: true, assignedToId: true } });
    const candidates = scanned.slice(0, FACET_SCAN_LIMIT);
    const visible = await this.filterVisibleFindings(user, candidates);
    const assigneeId = query.assignee === 'me' ? user.id : query.assignee;
    this.assigneeWhere(user, query.assignee); // validates the assignee value
    const match = (item: (typeof visible)[number], skip: 'status' | 'severity' | 'rule' | 'assignee') =>
      (skip === 'status' || !query.status || item.status === query.status)
      && (skip === 'severity' || !query.severity || item.severity === query.severity)
      && (skip === 'rule' || !query.rule || item.rule === query.rule)
      && (skip === 'assignee' || !assigneeId || (assigneeId === 'unassigned' ? item.assignedToId === null : item.assignedToId === assigneeId));
    const count = <K extends string>(skip: 'status' | 'severity' | 'rule' | 'assignee', key: (item: (typeof visible)[number]) => K) => {
      const map = new Map<K, number>(); for (const item of visible) if (match(item, skip)) map.set(key(item), (map.get(key(item)) ?? 0) + 1); return map;
    };
    const byRuleStatus = new Map<string, Record<string, number>>();
    for (const item of visible) if (match(item, 'rule') && match(item, 'status')) { const entry = byRuleStatus.get(item.rule) ?? {}; entry[item.status] = (entry[item.status] ?? 0) + 1; byRuleStatus.set(item.rule, entry); }
    const assigneeCounts = count('assignee', (item) => item.assignedToId ?? 'unassigned');
    const users = await this.prisma.user.findMany({ where: { id: { in: [...assigneeCounts.keys()].filter((id) => id !== 'unassigned') } }, select: { id: true, username: true, displayName: true } });
    const userById = new Map(users.map((item) => [item.id, item]));
    return {
      total: visible.filter((item) => match(item, 'status') && (!query.status || item.status === query.status)).length,
      byStatus: Object.fromEntries(['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED'].map((status) => [status, count('status', (item) => item.status).get(status as never) ?? 0])),
      bySeverity: Object.fromEntries(['CRITICAL', 'HIGH', 'WARNING', 'INFO'].map((severity) => [severity, count('severity', (item) => item.severity).get(severity as never) ?? 0])),
      byRule: [...count('rule', (item) => item.rule).entries()].map(([rule, total]) => ({ rule, total, byStatus: byRuleStatus.get(rule) ?? {} })).sort((a, b) => b.total - a.total || a.rule.localeCompare(b.rule)),
      truncated: scanned.length > FACET_SCAN_LIMIT,
      byAssignee: [...assigneeCounts.entries()].map(([id, total]) => id === 'unassigned' ? { userId: null, username: null, displayName: null, total } : { userId: id, username: userById.get(id)?.username ?? null, displayName: userById.get(id)?.displayName ?? null, total }).sort((a, b) => b.total - a.total),
    };
  }

  /** Applies one action to many findings. Each item is checked on its own (visibility, Site permission, assignee scope); one failure does not stop the rest. */
  async bulk(user: AuthenticatedUser, dto: BulkFindingActionDto) {
    if (dto.action !== 'SNOOZE' && (dto.until !== undefined || dto.durationHours !== undefined)) throw new BadRequestException({ code: 'BULK_FIELDS_INVALID', message: 'until/durationHours só se aplicam a SNOOZE.' });
    if (dto.action !== 'ASSIGN' && dto.userId !== undefined) throw new BadRequestException({ code: 'BULK_FIELDS_INVALID', message: 'userId só se aplica a ASSIGN.' });
    const until = dto.action === 'SNOOZE' ? resolveSnoozeUntil(dto) : undefined;
    const results: BulkItemResult[] = [];
    for (const id of dto.ids) {
      try {
        const updated = dto.action === 'ACKNOWLEDGE' ? await this.acknowledge(user, id)
          : dto.action === 'ASSIGN' ? await this.assign(user, id, { userId: dto.userId ?? null })
          : await this.applySnooze(user, id, until!, dto.reason);
        results.push({ id, ok: true, status: updated.status });
      } catch (error) { results.push(bulkFailure(id, error)); }
    }
    const succeeded = results.filter((item) => item.ok).length;
    return { action: dto.action, results, succeeded, failed: results.length - succeeded, ...(until ? { snoozedUntil: until.toISOString() } : {}) };
  }

  async list(user: AuthenticatedUser, query: ListFindingsQueryDto = {}) {
    const page = Math.max(Number(query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 100);
    const siteIds = await this.visibleSiteIds(user);
    if (query.siteId && !siteIds.includes(query.siteId)) throw new NotFoundException('Site não encontrado');
    const scope = query.siteId ? { siteId: query.siteId } : user.roles.includes('ADMIN') ? { OR: [{ siteId: null }, { siteId: { in: siteIds } }] } : { siteId: { in: siteIds } };
    const where = { AND: [scope, ...(query.status ? [{ status: query.status }] : []), ...(query.severity ? [{ severity: query.severity }] : []), ...(query.rule ? [{ rule: query.rule }] : []), ...this.assigneeWhere(user, query.assignee), ...(query.search ? [{ OR: [{ title: { contains: query.search, mode: 'insensitive' as const } }, { detail: { contains: query.search, mode: 'insensitive' as const } }] }] : [])] };
    const candidates = await this.prisma.inventoryFinding.findMany({ where, orderBy: [{ severity: 'asc' }, { lastDetectedAt: 'desc' }], include: { site: { select: { id: true, name: true } }, assignedTo: { select: { id: true, username: true, displayName: true } } } });
    const visible = await this.filterVisibleFindings(user, candidates);
    const pageItems = visible.slice((page - 1) * pageSize, page * pageSize);
    const interfaceIds = pageItems.filter((item) => item.entityType === 'DeviceInterface').map((item) => item.entityId);
    const interfaceOwners = interfaceIds.length ? await this.prisma.deviceInterface.findMany({ where: { id: { in: interfaceIds } }, select: { id: true, deviceId: true } }) : [];
    const ownerByInterface = new Map(interfaceOwners.map((item) => [item.id, item.deviceId]));
    const driftIds = pageItems.filter((item) => item.entityType === 'SnmpDrift').map((item) => item.entityId);
    const driftOwners = driftIds.length ? await this.prisma.snmpDrift.findMany({ where: { id: { in: driftIds } }, select: { id: true, deviceId: true } }) : [];
    const ownerByDrift = new Map(driftOwners.map((item) => [item.id, item.deviceId]));
    const ipIds = pageItems.filter((item) => item.entityType === 'IpAddress').map((item) => item.entityId);
    const ipTargets = ipIds.length ? await this.prisma.ipAddress.findMany({ where: { id: { in: ipIds } }, select: { id: true, subnetId: true } }) : [];
    const subnetByIp = new Map(ipTargets.map((item) => [item.id, item.subnetId]));
    const suggestions: Record<string, string> = {
      DEVICE_MISSING_SITE: 'Associar o equipamento ao Site correto.', DEVICE_MISSING_LOCATION: 'Atribuir o equipamento ao bastidor e à posição física corretos.', DEVICE_MISSING_MODEL: 'Associar o modelo de equipamento correspondente.',
      NETWORK_DEVICE_MISSING_MANAGEMENT_IP: 'Atribuir um endereço IP de gestão válido ao equipamento.', INTERFACE_MISSING_MODE: 'Definir o modo da interface como ACCESS ou TRUNK.', ACCESS_INTERFACE_MISSING_VLAN: 'Selecionar a VLAN de acesso da interface.', TRUNK_INTERFACE_MISSING_VLANS: 'Adicionar as VLANs permitidas nesta interface trunk.',
      NETWORK_MODEL_MISSING_PORT_MAP: 'Completar e guardar o mapa de portas do modelo (frente e traseira) até todas as portas de rede estarem mapeadas.', DEVICE_MODEL_MISSING_FRONT_IMAGE: 'Carregar a imagem frontal do modelo.', STALE_SNMP_OBSERVATION: 'Confirmar conectividade e configuração SNMP ou atualizar o inventário manualmente.', STALE_SNMP_DRIFT: 'Rever e resolver a divergência SNMP pendente.', DUPLICATE_IP_ROUTING_DOMAIN: 'Verificar as atribuições duplicadas e corrigir o endereço ou domínio de routing.',
    };
    const items = pageItems.map((item) => {
      const deviceId = item.entityType === 'Device' ? item.entityId : item.entityType === 'DeviceInterface' ? ownerByInterface.get(item.entityId) : item.entityType === 'SnmpDrift' ? ownerByDrift.get(item.entityId) : undefined;
      const href = item.rule === 'DEVICE_MISSING_SITE' && item.entityType === 'Device' ? `/infraestrutura?tab=devices&deviceId=${encodeURIComponent(item.entityId)}&focus=device` : deviceId && item.siteId && item.entityType === 'SnmpDrift' ? `/snmp?siteId=${encodeURIComponent(item.siteId)}&deviceId=${encodeURIComponent(deviceId)}` : deviceId && item.siteId ? `/infraestrutura?siteId=${encodeURIComponent(item.siteId)}&tab=${item.entityType === 'DeviceInterface' ? 'interfaces' : 'devices'}&deviceId=${encodeURIComponent(deviceId)}${item.entityType === 'DeviceInterface' ? `&interfaceId=${encodeURIComponent(item.entityId)}` : ''}` : item.entityType === 'IpAddress' && item.siteId && subnetByIp.has(item.entityId) ? `/ipam?siteId=${encodeURIComponent(item.siteId)}&subnetId=${encodeURIComponent(subnetByIp.get(item.entityId)!)}&ipId=${encodeURIComponent(item.entityId)}` : item.entityType === 'DeviceModel' && item.siteId ? `/infraestrutura?siteId=${encodeURIComponent(item.siteId)}&tab=models&modelId=${encodeURIComponent(item.entityId)}${item.rule === 'NETWORK_MODEL_MISSING_PORT_MAP' ? '&focus=port-layout' : ''}` : null;
      return { ...item, actionHref: href, suggestedCorrection: suggestions[item.rule] ?? 'Abrir o registo e corrigir os dados que originaram este finding.' };
    });
    return { items, total: visible.length, page, pageSize };
  }

  async summary(user: AuthenticatedUser, siteId?: string) {
    const siteIds = await this.visibleSiteIds(user); if (siteId && !siteIds.includes(siteId)) throw new NotFoundException('Site não encontrado');
    const where = { AND: [siteId ? { siteId } : user.roles.includes('ADMIN') ? { OR: [{ siteId: null }, { siteId: { in: siteIds } }] } : { siteId: { in: siteIds } }, { status: { not: 'RESOLVED' as const } }] };
    const [findingCandidates, deviceCandidates] = await Promise.all([
      this.prisma.inventoryFinding.findMany({ where }),
      this.prisma.device.findMany({ where: { siteId: siteId ?? { in: siteIds } }, select: { id: true } }),
    ]);
    const visible = await this.filterVisibleFindings(user, findingCandidates);
    const visibleDevices = user.roles.includes('ADMIN') ? deviceCandidates : (await Promise.all(deviceCandidates.map(async (device) => { try { await this.access.assertDevice(user, 'READ', device.id); return device; } catch { return null; } }))).filter((item): item is { id: string } => Boolean(item));
    const visibleDeviceIds = new Set(visibleDevices.map(({ id }) => id));
    const deviceIdsByEntity = new Map<string, Set<string>>();
    const addDevice = (entityType: string, entityId: string, deviceId: string | null | undefined) => {
      if (!deviceId || !visibleDeviceIds.has(deviceId)) return;
      const key = `${entityType}:${entityId}`;
      const ids = deviceIdsByEntity.get(key) ?? new Set<string>(); ids.add(deviceId); deviceIdsByEntity.set(key, ids);
    };
    for (const item of visible) if (item.entityType === 'Device') addDevice(item.entityType, item.entityId, item.entityId);
    const interfaces = await this.prisma.deviceInterface.findMany({ where: { id: { in: visible.filter((item) => item.entityType === 'DeviceInterface').map((item) => item.entityId) } }, select: { id: true, deviceId: true } });
    for (const item of interfaces) addDevice('DeviceInterface', item.id, item.deviceId);
    const drifts = await this.prisma.snmpDrift.findMany({ where: { id: { in: visible.filter((item) => item.entityType === 'SnmpDrift').map((item) => item.entityId) } }, select: { id: true, deviceId: true } });
    for (const item of drifts) addDevice('SnmpDrift', item.id, item.deviceId);
    const models = await this.prisma.device.findMany({ where: { modelId: { in: [...new Set(visible.filter((item) => item.entityType === 'DeviceModel').map((item) => item.entityId))] }, siteId: siteId ?? { in: siteIds } }, select: { id: true, modelId: true } });
    for (const item of models) if (item.modelId) addDevice('DeviceModel', item.modelId, item.id);
    const ips = await this.prisma.ipAddress.findMany({ where: { id: { in: visible.filter((item) => item.entityType === 'IpAddress').map((item) => item.entityId) } }, select: { id: true, deviceId: true, interface: { select: { deviceId: true } } } });
    for (const item of ips) addDevice('IpAddress', item.id, item.deviceId ?? item.interface?.deviceId);
    const groupMap = new Map<string, { status: string; severity: string; _count: { _all: number } }>();
    for (const item of visible) { const key = `${item.status}:${item.severity}`; const group = groupMap.get(key) ?? { status: item.status, severity: item.severity, _count: { _all: 0 } }; group._count._all += 1; groupMap.set(key, group); }
    const groups = [...groupMap.values()]; const deviceCount = visibleDevices.length;
    const affectedEntities = new Set(visible.map((item) => `${item.entityType}:${item.entityId}`));
    const affectedDevices = new Set([...deviceIdsByEntity.values()].flatMap((ids) => [...ids]));
    const validDeviceCount = Math.max(deviceCount - affectedDevices.size, 0);
    const staleFindingCount = visible.filter((item) => ['STALE_SNMP_OBSERVATION', 'STALE_SNMP_DRIFT'].includes(item.rule)).length;
    return {
      // Keep the legacy fields stable for existing cards while making their units explicit.
      total: deviceCount, invalid: affectedDevices.size, valid: validDeviceCount, stale: staleFindingCount,
      deviceCount, affectedDeviceCount: affectedDevices.size, validDeviceCount,
      affectedEntityCount: affectedEntities.size, findingCount: visible.length, staleFindingCount,
      score: deviceCount ? Math.max(0, Math.round((validDeviceCount / deviceCount) * 100)) : 100, groups,
    };
  }

  async assignees(user: AuthenticatedUser, siteId: string) {
    if (!await this.canSeeSite(user, siteId)) throw new NotFoundException('Site não encontrado');
    return this.prisma.user.findMany({ where: { roles: { some: { role: { in: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'] } } }, OR: [{ roles: { some: { role: 'ADMIN' } } }, { accessGroupMemberships: { some: { group: { siteAssignments: { some: { siteId } } } } } }] }, select: { id: true, username: true, displayName: true }, orderBy: { username: 'asc' } });
  }

  async acknowledge(user: AuthenticatedUser, id: string) {
    await this.mutable(user, id); const now = new Date();
    const finding = await this.prisma.inventoryFinding.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: now, acknowledgedById: user.id, snoozedUntil: null } });
    await this.audit.record({ userId: user.id, action: 'INVENTORY_FINDING_ACKNOWLEDGED', entityType: 'InventoryFinding', entityId: id }); return finding;
  }

  async assign(user: AuthenticatedUser, id: string, dto: AssignFindingDto) {
    const finding = await this.mutable(user, id);
    if (dto.userId) {
      if (!finding.siteId) throw new BadRequestException('Findings globais não podem ser atribuídos');
      const assignee = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, roles: { select: { role: true } }, accessGroupMemberships: { where: { group: { siteAssignments: { some: { siteId: finding.siteId } } } }, select: { groupId: true } } } });
      const operational = assignee?.roles.some(({ role }) => ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'].includes(role));
      if (!assignee || !operational || (!assignee.roles.some(({ role }) => role === 'ADMIN') && !assignee.accessGroupMemberships.length)) throw new BadRequestException('O responsável tem de ser um membro operacional com acesso ao Site');
    }
    const updated = await this.prisma.inventoryFinding.update({ where: { id }, data: { assignedToId: dto.userId ?? null } });
    await this.audit.record({ userId: user.id, action: 'INVENTORY_FINDING_ASSIGNED', entityType: 'InventoryFinding', entityId: id, metadata: { assignedToId: dto.userId ?? null } }); return updated;
  }

  async snooze(user: AuthenticatedUser, id: string, dto: SnoozeFindingDto) {
    return this.applySnooze(user, id, resolveSnoozeUntil(dto), dto.reason);
  }

  private async applySnooze(user: AuthenticatedUser, id: string, until: Date, reason?: string) {
    await this.mutable(user, id);
    const finding = await this.prisma.inventoryFinding.update({ where: { id }, data: { status: 'SNOOZED', snoozedUntil: until, snoozeReason: reason } });
    await this.audit.record({ userId: user.id, action: 'INVENTORY_FINDING_SNOOZED', entityType: 'InventoryFinding', entityId: id, metadata: { until, reason } }); return finding;
  }

  async reconcile(user: AuthenticatedUser, siteId?: string) {
    if (!user.roles.includes('ADMIN')) throw new ForbiddenException();
    const result = await this.reconcileSite(siteId);
    await this.audit.record({ userId: user.id, action: 'INVENTORY_QUALITY_RECONCILED', entityType: 'Site', entityId: siteId, metadata: result }); return result;
  }

  async reconcileSite(siteId?: string) {
    if (siteId && !await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })) throw new NotFoundException('Site não encontrado');
    const candidates = await this.detect(siteId);
    const detected = new Set(candidates.map((item) => item.dedupKey)); const now = new Date();
    for (const candidate of candidates) {
      const existing = await this.prisma.inventoryFinding.findUnique({ where: { dedupKey: candidate.dedupKey }, select: { status: true, snoozedUntil: true } });
      const reopen = existing?.status === 'RESOLVED' || (existing?.status === 'SNOOZED' && existing.snoozedUntil !== null && existing.snoozedUntil <= now);
      const finding = await this.prisma.inventoryFinding.upsert({
        where: { dedupKey: candidate.dedupKey },
        create: { ...candidate, metadata: candidate.metadata ?? undefined, firstDetectedAt: now, lastDetectedAt: now },
        update: { ...candidate, metadata: candidate.metadata ?? undefined, lastDetectedAt: now, occurrenceCount: { increment: 1 }, ...(reopen ? { status: 'OPEN' as const, resolvedAt: null, acknowledgedAt: null, acknowledgedById: null, snoozedUntil: null, snoozeReason: null } : {}) },
      });
    }
    const alertCandidates = await Promise.all(candidates.filter((candidate) => candidate.severity === 'CRITICAL' || candidate.severity === 'HIGH').map(async (candidate) => {
      const finding = await this.prisma.inventoryFinding.findUniqueOrThrow({ where: { dedupKey: candidate.dedupKey }, select: { id: true } });
      return { dedupKey: `quality:${candidate.dedupKey}`, source: 'INVENTORY_QUALITY', severity: candidate.severity, siteId: candidate.siteId, entityType: 'InventoryFinding', entityId: finding.id, title: candidate.title, detail: candidate.detail, actionHref: '/qualidade-inventario' };
    }));
    await this.alerts.reconcileSource('INVENTORY_QUALITY', alertCandidates, siteId);
    const active = await this.prisma.inventoryFinding.findMany({ where: { ...(siteId ? { siteId } : {}), status: { not: 'RESOLVED' } }, select: { id: true, dedupKey: true } });
    const resolvedIds = active.filter((item) => !detected.has(item.dedupKey)).map((item) => item.id);
    if (resolvedIds.length) await this.prisma.inventoryFinding.updateMany({ where: { id: { in: resolvedIds } }, data: { status: 'RESOLVED', resolvedAt: now, snoozedUntil: null } });
    return { detected: candidates.length, resolved: resolvedIds.length, siteId: siteId ?? null };
  }

  private async detect(siteId?: string): Promise<Candidate[]> {
    const result: Candidate[] = []; const deviceWhere = siteId ? { siteId } : {};
    const devices = await this.prisma.device.findMany({ where: deviceWhere, include: { model: true, interfaces: { include: { allowedVlans: true } }, snmpSnapshots: { orderBy: { observedAt: 'desc' }, take: 1 } } });
    const add = (candidate: Candidate) => result.push(candidate);
    for (const device of devices) {
      const prefix = `device:${device.id}`; const currentSite = device.siteId;
      if (!currentSite) add({ dedupKey: `${prefix}:missing-site`, siteId: null, rule: 'DEVICE_MISSING_SITE', severity: AlertSeverityDto.HIGH, entityType: 'Device', entityId: device.id, title: 'Equipamento sem Site', detail: `${device.name} não está associado a um Site.` });
      if (currentSite && !device.rackId) add({ dedupKey: `${prefix}:missing-location`, siteId: currentSite, rule: 'DEVICE_MISSING_LOCATION', severity: AlertSeverityDto.WARNING, entityType: 'Device', entityId: device.id, title: 'Equipamento sem localização', detail: `${device.name} não está colocado num bastidor.` });
      if (currentSite && !device.modelId) add({ dedupKey: `${prefix}:missing-model`, siteId: currentSite, rule: 'DEVICE_MISSING_MODEL', severity: AlertSeverityDto.WARNING, entityType: 'Device', entityId: device.id, title: 'Equipamento sem modelo', detail: `${device.name} não tem modelo associado.` });
      if (currentSite && ['SWITCH', 'ROUTER', 'FIREWALL'].includes(device.type) && device.status === 'ACTIVE' && !device.managementIp) add({ dedupKey: `${prefix}:missing-management-ip`, siteId: currentSite, rule: 'NETWORK_DEVICE_MISSING_MANAGEMENT_IP', severity: AlertSeverityDto.HIGH, entityType: 'Device', entityId: device.id, title: 'Equipamento de rede sem IP de gestão', detail: `${device.name} está ativo mas não tem IP de gestão.` });
      if (currentSite && device.model) {
        const model = device.model; const mapping = portMappingStatus(model);
        if (model.supportsNetworkPorts && (!mapping.complete || mapping.expected === 0)) add({ dedupKey: `model:${model.id}:site:${currentSite}:missing-port-map`, siteId: currentSite, rule: 'NETWORK_MODEL_MISSING_PORT_MAP', severity: AlertSeverityDto.WARNING, entityType: 'DeviceModel', entityId: model.id, title: 'Mapeamento de portas em falta', detail: mapping.expected === 0 ? `${model.manufacturer} ${model.model} tem portas de rede mas não tem o número de portas definido.` : `${model.manufacturer} ${model.model}: ${portLayoutIncompleteMessage(mapping)}`, metadata: { expected: mapping.expected, mapped: mapping.mapped, partialFaces: mapping.partialFaces.join(',') } });
        if (!model.frontAssetId) add({ dedupKey: `model:${model.id}:site:${currentSite}:missing-front-image`, siteId: currentSite, rule: 'DEVICE_MODEL_MISSING_FRONT_IMAGE', severity: AlertSeverityDto.WARNING, entityType: 'DeviceModel', entityId: model.id, title: 'Sem vista frontal', detail: `${model.manufacturer} ${model.model} não tem imagem frontal.` });
      }
      for (const iface of device.interfaces) {
        if (!currentSite) continue;
        if (!iface.mode) add({ dedupKey: `interface:${iface.id}:missing-mode`, siteId: currentSite, rule: 'INTERFACE_MISSING_MODE', severity: AlertSeverityDto.WARNING, entityType: 'DeviceInterface', entityId: iface.id, title: 'Interface sem modo', detail: `${device.name} · ${iface.name} não tem modo definido.` });
        if (iface.mode === 'ACCESS' && !iface.accessVlanId) add({ dedupKey: `interface:${iface.id}:access-vlan`, siteId: currentSite, rule: 'ACCESS_INTERFACE_MISSING_VLAN', severity: AlertSeverityDto.HIGH, entityType: 'DeviceInterface', entityId: iface.id, title: 'Interface ACCESS sem VLAN', detail: `${device.name} · ${iface.name} não tem access VLAN.` });
        if (iface.mode === 'TRUNK' && !iface.allowedVlans.length) add({ dedupKey: `interface:${iface.id}:trunk-vlans`, siteId: currentSite, rule: 'TRUNK_INTERFACE_MISSING_VLANS', severity: AlertSeverityDto.HIGH, entityType: 'DeviceInterface', entityId: iface.id, title: 'Interface TRUNK sem VLANs permitidas', detail: `${device.name} · ${iface.name} não tem VLANs permitidas.` });
      }
      const observedAt = device.snmpSnapshots[0]?.observedAt;
      if (currentSite && observedAt && observedAt < new Date(Date.now() - 30 * 86_400_000)) add({ dedupKey: `${prefix}:stale-snmp`, siteId: currentSite, rule: 'STALE_SNMP_OBSERVATION', severity: AlertSeverityDto.WARNING, entityType: 'Device', entityId: device.id, title: 'Observação SNMP desatualizada', detail: `${device.name} não é observado por SNMP há mais de 30 dias.`, metadata: { observedAt: observedAt.toISOString() } });
    }
    const drifts = await this.prisma.snmpDrift.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) }, ...(siteId ? { device: { siteId } } : {}) }, include: { device: { select: { id: true, name: true, siteId: true } } } });
    for (const drift of drifts) if (drift.device.siteId) add({ dedupKey: `snmp-drift:${drift.id}:stale`, siteId: drift.device.siteId, rule: 'STALE_SNMP_DRIFT', severity: AlertSeverityDto.HIGH, entityType: 'SnmpDrift', entityId: drift.id, title: 'Divergência SNMP pendente', detail: `${drift.device.name}: ${drift.field} está pendente há mais de sete dias.` });
    const ips = await this.prisma.ipAddress.findMany({ where: siteId ? { subnet: { siteId } } : {}, select: { id: true, address: true, subnet: { select: { siteId: true, vrfId: true } } } });
    const groups = new Map<string, typeof ips>();
    for (const ip of ips) { const effective = ip.subnet.vrfId ?? ip.subnet.siteId; if (!effective || !ip.subnet.siteId) continue; const key = `${effective}:${ip.address}`; groups.set(key, [...(groups.get(key) ?? []), ip]); }
    for (const [key, duplicates] of groups) if (duplicates.length > 1) add({ dedupKey: `duplicate-ip:${key}`, siteId: duplicates[0].subnet.siteId, rule: 'DUPLICATE_IP_ROUTING_DOMAIN', severity: AlertSeverityDto.CRITICAL, entityType: 'IpAddress', entityId: duplicates[0].id, title: 'IP duplicado no domínio de routing', detail: `${duplicates[0].address} aparece ${duplicates.length} vezes no mesmo domínio de routing.`, metadata: { count: duplicates.length } });
    return result;
  }
}

/** Runs from the standalone BullMQ worker; scoped access and audit are not used by reconciliation. */
export async function runInventoryQualityReconciliation(prisma: PrismaClient, siteId?: string) {
  const operations = new OperationsService(prisma, undefined as never, undefined as never, undefined as never);
  const service = new InventoryQualityService(prisma, undefined as never, undefined as never, operations, undefined as never);
  return service.reconcileSite(siteId);
}
