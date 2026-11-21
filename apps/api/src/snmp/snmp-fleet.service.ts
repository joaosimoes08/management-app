import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { errorBody } from '../common/bulk-result';
import { SnmpService } from './snmp.service';

export const SNMP_NETWORK_TYPES = ['SWITCH', 'ROUTER', 'FIREWALL'];
const POLL_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'] as const;
const DRIFT_STATUSES = ['PENDING', 'ACCEPTED', 'IGNORED'];

export type FleetDevice = {
  id: string; name: string; type: string; siteId: string;
  snmpConfig: { enabled: boolean; intervalMinutes: number; lastPollAt: Date | null; nextPollAt: Date | null; lastStatus: string | null; lastErrorCode: string | null } | null;
  pendingDrifts: number;
};

/** A poll is stale when the last poll is older than twice the configured interval. */
export function isSnmpPollStale(config: { enabled: boolean; intervalMinutes: number; lastPollAt: Date | null }, now: Date) {
  return config.enabled && config.lastPollAt !== null && now.getTime() - config.lastPollAt.getTime() > config.intervalMinutes * 2 * 60_000;
}

export function summarizeSnmpFleet(devices: FleetDevice[], now = new Date()) {
  const byStatus: Record<string, number> = Object.fromEntries([...POLL_STATUSES, 'NEVER_POLLED'].map((status) => [status, 0]));
  let configured = 0; let enabled = 0; let stale = 0; let pendingDrifts = 0; let devicesWithDrift = 0;
  let lastPollAt: Date | null = null; let oldestPollAt: Date | null = null;
  const attention: Array<{ deviceId: string; name: string; siteId: string; reason: 'FAILED' | 'BLOCKED' | 'STALE' | 'NEVER_POLLED'; lastStatus: string | null; lastPollAt: Date | null; lastErrorCode: string | null; pendingDrifts: number }> = [];
  for (const device of devices) {
    pendingDrifts += device.pendingDrifts;
    if (device.pendingDrifts > 0) devicesWithDrift += 1;
    const config = device.snmpConfig;
    if (!config) continue;
    configured += 1;
    if (!config.enabled) continue;
    enabled += 1;
    if (!config.lastPollAt) byStatus.NEVER_POLLED += 1; else byStatus[config.lastStatus ?? 'PENDING'] = (byStatus[config.lastStatus ?? 'PENDING'] ?? 0) + 1;
    if (config.lastPollAt) {
      if (!lastPollAt || config.lastPollAt > lastPollAt) lastPollAt = config.lastPollAt;
      if (!oldestPollAt || config.lastPollAt < oldestPollAt) oldestPollAt = config.lastPollAt;
    }
    const isStale = isSnmpPollStale(config, now);
    if (isStale) stale += 1;
    const reason = config.lastStatus === 'FAILED' ? 'FAILED' : config.lastStatus === 'BLOCKED' ? 'BLOCKED' : isStale ? 'STALE' : !config.lastPollAt ? 'NEVER_POLLED' : null;
    if (reason) attention.push({ deviceId: device.id, name: device.name, siteId: device.siteId, reason, lastStatus: config.lastStatus, lastPollAt: config.lastPollAt, lastErrorCode: config.lastErrorCode, pendingDrifts: device.pendingDrifts });
  }
  const order = { FAILED: 0, BLOCKED: 1, STALE: 2, NEVER_POLLED: 3 };
  attention.sort((left, right) => order[left.reason] - order[right.reason] || left.name.localeCompare(right.name));
  return {
    generatedAt: now.toISOString(),
    devices: { total: devices.length, configured, enabled, disabled: configured - enabled, notConfigured: devices.length - configured },
    polling: { byStatus, stale, lastPollAt, oldestPollAt },
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
    return { siteId: siteId ?? null, ...summarizeSnmpFleet(devices.map(({ _count, ...device }) => ({ ...device, pendingDrifts: _count.snmpDrifts })) as FleetDevice[]) };
  }

  /** GET snmp/drifts — drift list across visible devices (default status PENDING). */
  async listDrifts(user: AuthenticatedUser, query: { status?: string; siteId?: string; deviceId?: string; page?: string; pageSize?: string }) {
    const statuses = (query.status || 'PENDING').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (!statuses.length || statuses.some((value) => !DRIFT_STATUSES.includes(value))) throw new BadRequestException({ code: 'SNMP_DRIFT_STATUS_INVALID', message: 'status deve ser PENDING, ACCEPTED ou IGNORED.' });
    const page = Math.max(Number(query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 100);
    const visible = await this.visibleDeviceWhere(user, query.siteId);
    const where = { status: { in: statuses as never[] }, ...(query.deviceId ? { deviceId: query.deviceId } : {}), device: visible };
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
