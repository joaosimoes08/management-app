import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure-access.service';
import {
  deviceSettingsHref, FEATURE_CONFIG_KEYS, isFeatureConfigKey, missingConfigListHref, missingConfigWhere, requiredConfig,
  type FeatureConfigKey, type RequiredConfigError,
} from './device-required-config';

/** 400 thrown when a save does not satisfy the required configurations. Body: { code, message, details: { errors } }. */
export class RequiredConfigException extends BadRequestException {
  constructor(errors: RequiredConfigError[]) {
    super({
      code: 'REQUIRED_CONFIG_MISSING',
      message: errors.length === 1 ? errors[0].message : `Faltam ${errors.length} configurações obrigatórias.`,
      details: { errors },
    });
  }
}

/** Device types a role may manage — mirrors InfrastructureService.assertDeviceCapability. null = every type. */
export function manageableDeviceTypes(user: AuthenticatedUser): string[] | null | 'none' {
  if (user.roles.includes('ADMIN') || user.roles.includes('SYSTEMS_OPERATOR')) return null;
  if (user.roles.includes('NETWORK_OPERATOR')) return ['SWITCH', 'ROUTER', 'FIREWALL'];
  return 'none';
}

export interface MissingConfigGroup {
  config: FeatureConfigKey;
  count: number;
  tab: string;
  label: string;
  /** Present when every affected device is in one Site. */
  siteId: string | null;
  /** How many Sites the affected devices are spread over (a device without a Site counts as one group). */
  siteCount: number;
  /** Present when count === 1. */
  device: { id: string; name: string; siteId: string | null } | null;
  href: string;
}

/** Topbar alert shape (same as DashboardService's TopbarAlert plus persistent/kind/count). */
export interface MissingConfigAlert {
  id: string;
  severity: 'WARNING';
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
  persistent: true;
  kind: 'DEVICE_MISSING_CONFIG';
  config: FeatureConfigKey;
  count: number;
  siteCount: number;
}

@Injectable()
export class DeviceRequiredConfigService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService) {}

  /** Devices this user can see AND manage. Feature configs only apply to racked devices, so racks are enough. */
  private async scopeWhere(user: AuthenticatedUser, siteId?: string) {
    const types = manageableDeviceTypes(user);
    if (types === 'none') return null;
    const roomIds = await this.access.visibleRoomIds(user, siteId);
    return { rack: { roomId: { in: roomIds } }, ...(siteId ? { siteId } : {}), ...(types ? { type: { in: types } } : {}) };
  }

  /**
   * One group per FEATURE config with at least one affected device. Live query: no stored state.
   * Cost per call: visibleRoomIds once, then one `GROUP BY siteId` per config (both in parallel), plus one lookup
   * only for a config with exactly one affected device (to deep-link to it).
   */
  async missingSummary(user: AuthenticatedUser, siteId?: string): Promise<{ items: MissingConfigGroup[] }> {
    const scope = await this.scopeWhere(user, siteId);
    if (!scope) return { items: [] };
    const groups = await Promise.all(FEATURE_CONFIG_KEYS.map(async (key): Promise<MissingConfigGroup | null> => {
      const where = { AND: [scope, missingConfigWhere(key)] };
      const bySite = await this.prisma.device.groupBy({ by: ['siteId'], where, _count: { _all: true } });
      const count = bySite.reduce((total, row) => total + row._count._all, 0);
      if (!count) return null;
      const config = requiredConfig(key);
      const onlySiteId = bySite.length === 1 ? bySite[0].siteId : null;
      const device = count === 1 ? await this.prisma.device.findFirst({ where, select: { id: true, name: true, siteId: true } }) : null;
      const siteCount = bySite.length;
      return { config: key, count, tab: config.tab, label: config.label, siteId: onlySiteId, siteCount, device, href: device ? deviceSettingsHref(device, config.tab) : missingConfigListHref(key, onlySiteId, siteCount) };
    }));
    return { items: groups.filter((group): group is MissingConfigGroup => group !== null) };
  }

  /** Grouped, persistent bell alerts. Ids are stable per config, so a refresh never duplicates them. */
  async topbarAlerts(user: AuthenticatedUser): Promise<MissingConfigAlert[]> {
    const { items } = await this.missingSummary(user);
    const occurredAt = new Date().toISOString();
    return items.map((group) => {
      const config = requiredConfig(group.config);
      const title = group.count === 1 ? config.alertTitle!.one : config.alertTitle!.other.replace('{count}', String(group.count));
      const base = group.siteCount > 1 ? `${config.alertDetail!.replace(/\.$/, '')} — em ${group.siteCount} Sites.` : config.alertDetail!;
      const detail = group.device ? `${group.device.name}: ${base}` : base;
      return { id: `device-missing-config-${group.config}`, severity: 'WARNING', title, detail, href: group.href, occurredAt, persistent: true, kind: 'DEVICE_MISSING_CONFIG', config: group.config, count: group.count, siteCount: group.siteCount };
    });
  }

  /**
   * GET /devices/missing-config?config=…: the affected devices, paginated. Without siteId it uses the same scope and
   * filter as missingSummary/topbarAlerts, so `total` equals the bell `count` (with allSites=1 the web omits siteId).
   */
  async listMissing(user: AuthenticatedUser, configText: string | undefined, siteId?: string, pageText?: string, pageSizeText?: string) {
    if (!isFeatureConfigKey(configText)) throw new BadRequestException({ code: 'UNKNOWN_REQUIRED_CONFIG', message: `Configuração desconhecida. Usa uma de: ${FEATURE_CONFIG_KEYS.join(', ')}.` });
    const page = Math.max(Number(pageText) || 1, 1);
    const pageSize = Math.min(Math.max(Number(pageSizeText) || 25, 1), 100);
    const scope = await this.scopeWhere(user, siteId);
    const config = requiredConfig(configText);
    if (!scope) return { config: configText, tab: config.tab, items: [], page, pageSize, total: 0, totalPages: 0 };
    const where = { AND: [scope, missingConfigWhere(configText)] };
    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, name: true, type: true, status: true, siteId: true, rackId: true, rackUnitStart: true, site: { select: { name: true } }, rack: { select: { name: true } }, model: { select: { id: true, manufacturer: true, model: true } } },
      }),
      this.prisma.device.count({ where }),
    ]);
    return {
      config: configText, tab: config.tab,
      items: devices.map((device) => ({ ...device, siteName: device.site?.name ?? null, rackName: device.rack?.name ?? null, site: undefined, rack: undefined, href: deviceSettingsHref(device, config.tab) })),
      page, pageSize, total, totalPages: Math.ceil(total / pageSize),
    };
  }
}
