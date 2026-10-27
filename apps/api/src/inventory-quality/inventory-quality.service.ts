import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { AlertSeverityDto } from '../operations/dto';
import { OperationsService } from '../operations/operations.service';
import { AssignFindingDto, ListFindingsQueryDto, SnoozeFindingDto } from './dto';

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

  async list(user: AuthenticatedUser, query: ListFindingsQueryDto = {}) {
    const page = Math.max(Number(query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 100);
    const siteIds = await this.visibleSiteIds(user);
    if (query.siteId && !siteIds.includes(query.siteId)) throw new NotFoundException('Site não encontrado');
    const scope = query.siteId ? { siteId: query.siteId } : user.roles.includes('ADMIN') ? { OR: [{ siteId: null }, { siteId: { in: siteIds } }] } : { siteId: { in: siteIds } };
    const where = { AND: [scope, ...(query.status ? [{ status: query.status }] : []), ...(query.severity ? [{ severity: query.severity }] : []), ...(query.rule ? [{ rule: query.rule }] : []), ...(query.search ? [{ OR: [{ title: { contains: query.search, mode: 'insensitive' as const } }, { detail: { contains: query.search, mode: 'insensitive' as const } }] }] : [])] };
    const candidates = await this.prisma.inventoryFinding.findMany({ where, orderBy: [{ severity: 'asc' }, { lastDetectedAt: 'desc' }], include: { site: { select: { id: true, name: true } }, assignedTo: { select: { id: true, username: true, displayName: true } } } });
    const visible = await this.filterVisibleFindings(user, candidates);
    return { items: visible.slice((page - 1) * pageSize, page * pageSize), total: visible.length, page, pageSize };
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
    await this.mutable(user, id); const until = new Date(dto.until);
    if (until <= new Date()) throw new BadRequestException('A data de snooze tem de ser futura');
    const finding = await this.prisma.inventoryFinding.update({ where: { id }, data: { status: 'SNOOZED', snoozedUntil: until, snoozeReason: dto.reason } });
    await this.audit.record({ userId: user.id, action: 'INVENTORY_FINDING_SNOOZED', entityType: 'InventoryFinding', entityId: id, metadata: { until, reason: dto.reason } }); return finding;
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
      if (currentSite && device.model?.supportsNetworkPorts && !device.model.portLayout) add({ dedupKey: `model:${device.model.id}:site:${currentSite}:missing-port-map`, siteId: currentSite, rule: 'NETWORK_MODEL_MISSING_PORT_MAP', severity: AlertSeverityDto.WARNING, entityType: 'DeviceModel', entityId: device.model.id, title: 'Modelo de rede sem portas mapeadas', detail: `${device.model.manufacturer} ${device.model.model} não tem layout de portas.` });
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
