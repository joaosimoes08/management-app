import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, SnmpDriftStatus } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { errorBody } from '../common/bulk-result';
import { SnmpService } from './snmp.service';

export const SNMP_NETWORK_TYPES = ['SWITCH', 'ROUTER', 'FIREWALL'];
const POLL_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'] as const;
const DRIFT_STATUSES = ['PENDING', 'ACCEPTED', 'IGNORED'];
/** Upper bound for `deviceIds` on GET snmp/health, so one request can't ask for an unbounded list. */
export const SNMP_HEALTH_MAX_DEVICE_IDS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SnmpHealthBadgeStatus = 'OK' | 'DEGRADED' | 'UNKNOWN';
export type HealthSummaryDevice = {
  id: string;
  snmpConfig: { enabled: boolean; intervalMinutes: number } | null;
  snmpHealth: { status: string; observedAt: Date; issueCount: number; rebootDetectedAt: Date | null } | null;
};

/** Parses the comma-separated `deviceIds` filter of GET snmp/health (undefined when absent). */
export function parseHealthDeviceIds(value?: string) {
  if (value === undefined || value.trim() === '') return undefined;
  const ids = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (ids.length > SNMP_HEALTH_MAX_DEVICE_IDS) throw new BadRequestException({ code: 'SNMP_HEALTH_TOO_MANY_DEVICES', message: `deviceIds aceita no máximo ${SNMP_HEALTH_MAX_DEVICE_IDS} equipamentos.` });
  if (ids.some((id) => !UUID.test(id))) throw new BadRequestException({ code: 'SNMP_HEALTH_DEVICE_ID_INVALID', message: 'deviceIds deve ser uma lista de identificadores separados por vírgulas.' });
  return ids;
}

/**
 * SNMP Phase 2 step 10: one compact health line per device for the badges on lists, the rack and the topology.
 * `status` is null when no health reading exists yet ("Sem dados"). `stale` marks a reading older than twice the
 * poll interval (or any reading while polling is disabled), so the UI can say the badge may be out of date.
 */
export function summarizeSnmpHealth(devices: HealthSummaryDevice[], now = new Date()) {
  return devices.map((device) => {
    const health = device.snmpHealth;
    if (!health) return { deviceId: device.id, status: null, observedAt: null, issueCount: 0, rebootDetectedAt: null, stale: false };
    const status: SnmpHealthBadgeStatus = health.status === 'OK' || health.status === 'DEGRADED' ? health.status : 'UNKNOWN';
    const config = device.snmpConfig;
    const stale = !config || !config.enabled || now.getTime() - health.observedAt.getTime() > config.intervalMinutes * 2 * 60_000;
    return { deviceId: device.id, status, observedAt: health.observedAt, issueCount: health.issueCount, rebootDetectedAt: health.rebootDetectedAt, stale };
  });
}

export type FleetDevice = {
  id: string; name: string; type: string; siteId: string;
  snmpConfig: { enabled: boolean; intervalMinutes: number; lastPollAt: Date | null; nextPollAt: Date | null; lastStatus: string | null; lastErrorCode: string | null } | null;
  pendingDrifts: number;
};

/**
 * A poll is stale when the last poll is older than twice the configured interval. Round 2 #12: a device that was never
 * polled is stale too once its first scheduled poll (nextPollAt) is more than twice the interval in the past.
 */
export function isSnmpPollStale(config: { enabled: boolean; intervalMinutes: number; lastPollAt: Date | null; nextPollAt?: Date | null }, now: Date) {
  const reference = config.lastPollAt ?? config.nextPollAt ?? null;
  return config.enabled && reference !== null && now.getTime() - reference.getTime() > config.intervalMinutes * 2 * 60_000;
}

/** Codes recorded when the poll scheduler could not be created (see SnmpService.reconcileSchedulers). */
export const SNMP_SCHEDULER_ERROR_CODES = ['SNMP_QUEUE_UNAVAILABLE', 'SNMP_SCHEDULER_FAILED'];

export type SnmpPollingStopReason = 'NO_SCHEDULE' | 'STALE';

/**
 * Round 2 #12: why an enabled device's polling has stopped without failing, or null. NO_SCHEDULE: it has no poll
 * scheduler (nextPollAt was cleared and a scheduler error recorded because creating it failed). STALE: polls stopped arriving.
 */
export function snmpPollingStopReason(config: { enabled: boolean; intervalMinutes: number; lastPollAt: Date | null; nextPollAt: Date | null; lastErrorCode: string | null }, now: Date): SnmpPollingStopReason | null {
  if (!config.enabled) return null;
  if (!config.nextPollAt && SNMP_SCHEDULER_ERROR_CODES.includes(config.lastErrorCode ?? '')) return 'NO_SCHEDULE';
  return isSnmpPollStale(config, now) ? 'STALE' : null;
}

export function summarizeSnmpFleet(devices: FleetDevice[], now = new Date()) {
  const byStatus: Record<string, number> = Object.fromEntries([...POLL_STATUSES, 'NEVER_POLLED'].map((status) => [status, 0]));
  let configured = 0; let enabled = 0; let stale = 0; let noSchedule = 0; let pendingDrifts = 0; let devicesWithDrift = 0;
  let lastPollAt: Date | null = null; let oldestPollAt: Date | null = null;
  const attention: Array<{ deviceId: string; name: string; siteId: string; reason: 'FAILED' | 'BLOCKED' | 'NO_SCHEDULE' | 'STALE' | 'NEVER_POLLED' | 'NOT_CONFIGURED'; lastStatus: string | null; lastPollAt: Date | null; lastErrorCode: string | null; pendingDrifts: number }> = [];
  for (const device of devices) {
    pendingDrifts += device.pendingDrifts;
    if (device.pendingDrifts > 0) devicesWithDrift += 1;
    const config = device.snmpConfig;
    // SNMP Phase 1 step 5: a network device without SNMP is listed last, so the fleet view can offer "Configurar".
    if (!config) { attention.push({ deviceId: device.id, name: device.name, siteId: device.siteId, reason: 'NOT_CONFIGURED', lastStatus: null, lastPollAt: null, lastErrorCode: null, pendingDrifts: device.pendingDrifts }); continue; }
    configured += 1;
    if (!config.enabled) continue;
    enabled += 1;
    if (!config.lastPollAt) byStatus.NEVER_POLLED += 1; else byStatus[config.lastStatus ?? 'PENDING'] = (byStatus[config.lastStatus ?? 'PENDING'] ?? 0) + 1;
    if (config.lastPollAt) {
      if (!lastPollAt || config.lastPollAt > lastPollAt) lastPollAt = config.lastPollAt;
      if (!oldestPollAt || config.lastPollAt < oldestPollAt) oldestPollAt = config.lastPollAt;
    }
    const stopped = snmpPollingStopReason(config, now);
    if (stopped === 'STALE') stale += 1;
    if (stopped === 'NO_SCHEDULE') noSchedule += 1;
    const reason = config.lastStatus === 'FAILED' ? 'FAILED' : config.lastStatus === 'BLOCKED' ? 'BLOCKED' : stopped ?? (!config.lastPollAt ? 'NEVER_POLLED' : null);
    if (reason) attention.push({ deviceId: device.id, name: device.name, siteId: device.siteId, reason, lastStatus: config.lastStatus, lastPollAt: config.lastPollAt, lastErrorCode: config.lastErrorCode, pendingDrifts: device.pendingDrifts });
  }
  const order = { FAILED: 0, BLOCKED: 1, NO_SCHEDULE: 2, STALE: 3, NEVER_POLLED: 4, NOT_CONFIGURED: 5 };
  attention.sort((left, right) => order[left.reason] - order[right.reason] || left.name.localeCompare(right.name));
  return {
    generatedAt: now.toISOString(),
    devices: { total: devices.length, configured, enabled, disabled: configured - enabled, notConfigured: devices.length - configured },
    polling: { byStatus, stale, noSchedule, lastPollAt, oldestPollAt },
    drift: { pending: pendingDrifts, devicesWithPending: devicesWithDrift },
    attention: attention.slice(0, 10),
    attentionTotal: attention.length,
  };
}

@Injectable()
export class SnmpFleetService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService, private readonly snmp: SnmpService) {}

  private async visibleDeviceWhere(user: AuthenticatedUser, siteId?: string) {
    if (siteId && !await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site não encontrado.' });
    const [roomIds, unplacedSiteIds] = await Promise.all([this.access.visibleRoomIds(user, siteId), this.access.visibleUnplacedSiteIds(user, siteId)]);
    // A Site the caller has no visibility into looks the same as a missing one (Site isolation).
    if (siteId && !user.roles.includes('ADMIN') && !roomIds.length && !unplacedSiteIds.length) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site não encontrado.' });
    return { AND: [{ OR: [{ rack: { roomId: { in: roomIds } } }, { rackId: null, siteId: { in: unplacedSiteIds } }] }, ...(siteId ? [{ siteId }] : [])] };
  }

  /** GET snmp/fleet/summary — SNMP polling health across the visible network devices. */
  async fleetSummary(user: AuthenticatedUser, siteId?: string) {
    const visible = await this.visibleDeviceWhere(user, siteId);
    const devices = await this.prisma.device.findMany({
      where: { AND: [visible, { type: { in: SNMP_NETWORK_TYPES as never[] } }, { status: { not: 'RETIRED' } }] },
      select: { id: true, name: true, type: true, siteId: true, snmpConfig: { select: { enabled: true, intervalMinutes: true, lastPollAt: true, nextPollAt: true, lastStatus: true, lastErrorCode: true } }, _count: { select: { snmpDrifts: { where: { status: 'PENDING' } } } } },
    });
    return { siteId: siteId ?? null, ...summarizeSnmpFleet(devices.map(({ _count, ...device }) => ({ ...device, pendingDrifts: _count.snmpDrifts })) as FleetDevice[]), scheduler: this.snmp.schedulerHealth };
  }

  /**
   * GET snmp/health — SNMP Phase 2 step 10: latest health status of every visible network device (optionally one Site
   * and/or an explicit `deviceIds` list), in one query, so device lists don't fetch health per row. Same roles and Site
   * scoping as GET snmp/devices/:deviceId/health; devices the caller can't see are simply not returned.
   */
  async healthSummary(user: AuthenticatedUser, query: { siteId?: string; deviceIds?: string }) {
    const deviceIds = parseHealthDeviceIds(query.deviceIds);
    const visible = await this.visibleDeviceWhere(user, query.siteId);
    if (deviceIds && !deviceIds.length) return { siteId: query.siteId ?? null, items: [] };
    const devices = await this.prisma.device.findMany({
      where: { AND: [visible, { type: { in: SNMP_NETWORK_TYPES as never[] } }, ...(deviceIds ? [{ id: { in: deviceIds } }] : [])] },
      select: { id: true, snmpConfig: { select: { enabled: true, intervalMinutes: true } }, snmpHealth: { select: { status: true, observedAt: true, issueCount: true, rebootDetectedAt: true } } },
      orderBy: { name: 'asc' },
    });
    return { siteId: query.siteId ?? null, items: summarizeSnmpHealth(devices as HealthSummaryDevice[]) };
  }

  /** GET snmp/drifts — drift list across visible devices (default status PENDING). */
  async listDrifts(user: AuthenticatedUser, query: { status?: string; siteId?: string; deviceId?: string; page?: string; pageSize?: string }) {
    const statuses = (query.status || 'PENDING').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (!statuses.length || statuses.some((value) => !DRIFT_STATUSES.includes(value))) throw new BadRequestException({ code: 'SNMP_DRIFT_STATUS_INVALID', message: 'status deve ser PENDING, ACCEPTED ou IGNORED.' });
    const page = Math.max(Number(query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 100);
    const visible = await this.visibleDeviceWhere(user, query.siteId);
    const where = { status: { in: statuses as SnmpDriftStatus[] }, ...(query.deviceId ? { deviceId: query.deviceId } : {}), device: visible };
    const [items, total] = await Promise.all([
      this.prisma.snmpDrift.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { device: { select: { id: true, name: true, type: true, siteId: true } }, interface: { select: { id: true, name: true } } } }),
      this.prisma.snmpDrift.count({ where }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  /** POST snmp/drifts/bulk-review — reuses the single review (per-device UPDATE check, audit per drift). */
  async bulkReview(user: AuthenticatedUser, dto: { ids: string[]; status: 'ACCEPTED' | 'IGNORED' }) {
    const items = [];
    for (const id of dto.ids) {
      try { const drift = await this.snmp.reviewDrift(id, { status: dto.status }, user); items.push({ id, ok: true, status: drift.status }); }
      catch (error) { items.push({ id, ok: false, error: errorBody(error) }); }
    }
    const succeeded = items.filter((item) => item.ok).length;
    return { status: dto.status, total: items.length, succeeded, failed: items.length - succeeded, items };
  }
}
