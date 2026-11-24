import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import {
  DEFAULT_HEALTH_THRESHOLDS, effectiveHealthThresholds, HEALTH_CLEAR_MARGIN_CELSIUS, HEALTH_CLEAR_MARGIN_PERCENT, HEALTH_THRESHOLD_FIELDS,
  HealthThresholdOverride, REBOOT_ALERT_WINDOW_MS,
} from '../operations/health-alerts';
import { UpsertSnmpHealthThresholdsDto } from './dto';

/** Kept in step with HEALTH_HISTORY_RETENTION_DAYS in apps/snmp (the worker prunes; the API only reads). */
export const HEALTH_HISTORY_RETENTION_DAYS = 30;
const NETWORK_TYPES = ['SWITCH', 'ROUTER', 'FIREWALL'];

/** Fixed severities per condition (Joao's Phase 2 answer 12); only the limits are configurable. */
export const HEALTH_ALERT_SEVERITIES = {
  CPU: 'HIGH', MEMORY: 'HIGH', TEMPERATURE: 'HIGH (warning) / CRITICAL (critical)', POWER_SUPPLY: 'CRITICAL', FAN: 'CRITICAL', REBOOT: 'HIGH', INTERFACE_ERRORS: 'WARNING',
} as const;

type OverrideRow = { id: string; updatedAt: Date; updatedById: string | null } & { [K in typeof HEALTH_THRESHOLD_FIELDS[number]]: number | null };

/** SNMP Phase 2 step 9: per-Site and per-Device health alert limits, and the 30-day health history. */
@Injectable()
export class SnmpHealthThresholdsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService) {}

  defaults() {
    return {
      defaults: { ...DEFAULT_HEALTH_THRESHOLDS },
      severities: HEALTH_ALERT_SEVERITIES,
      clearMargins: { percent: HEALTH_CLEAR_MARGIN_PERCENT, celsius: HEALTH_CLEAR_MARGIN_CELSIUS, interfaceErrorsFactor: 0.5 },
      rebootAlertHours: REBOOT_ALERT_WINDOW_MS / 3_600_000,
      historyRetentionDays: HEALTH_HISTORY_RETENTION_DAYS,
    };
  }

  private view(row: OverrideRow | null) {
    if (!row) return null;
    return { ...Object.fromEntries(HEALTH_THRESHOLD_FIELDS.map((field) => [field, row[field]])), updatedAt: row.updatedAt, updatedById: row.updatedById };
  }

  private async networkDevice(user: AuthenticatedUser, deviceId: string, action: 'READ' | 'UPDATE') {
    await this.access.assertDevice(user, action, deviceId);
    const device = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, type: true, siteId: true } });
    if (!device) throw new NotFoundException('Equipamento não encontrado');
    if (!NETWORK_TYPES.includes(device.type)) throw new BadRequestException({ code: 'SNMP_DEVICE_TYPE_UNSUPPORTED', message: 'SNMP só pode ser configurado em equipamentos de rede.' });
    return device;
  }

  private data(dto: UpsertSnmpHealthThresholdsDto) {
    const data = Object.fromEntries(HEALTH_THRESHOLD_FIELDS.map((field) => [field, dto[field] ?? null])) as Record<typeof HEALTH_THRESHOLD_FIELDS[number], number | null>;
    if (data.temperatureHighCelsius !== null && data.temperatureCriticalCelsius !== null && data.temperatureCriticalCelsius < data.temperatureHighCelsius) {
      throw new BadRequestException({ code: 'SNMP_HEALTH_THRESHOLD_INVALID', message: 'A temperatura crítica tem de ser igual ou superior à temperatura de aviso.' });
    }
    return data;
  }

  async site(user: AuthenticatedUser, siteId: string) {
    await this.access.assertSite(user, 'READ', siteId, 'DEVICE', 'SWITCH');
    const site = await this.prisma.snmpHealthThreshold.findUnique({ where: { siteId } }) as OverrideRow | null;
    const effective = effectiveHealthThresholds(site as HealthThresholdOverride | null, null);
    return { siteId, defaults: { ...DEFAULT_HEALTH_THRESHOLDS }, site: this.view(site), effective: effective.values, sources: effective.sources };
  }

  async updateSite(user: AuthenticatedUser, siteId: string, dto: UpsertSnmpHealthThresholdsDto) {
    await this.access.assertSite(user, 'UPDATE', siteId, 'DEVICE', 'SWITCH');
    const data = { ...this.data(dto), updatedById: user.id };
    const row = await this.prisma.snmpHealthThreshold.upsert({ where: { siteId }, create: { siteId, ...data }, update: data });
    await this.audit.record({ userId: user.id, action: 'SNMP_HEALTH_THRESHOLDS_UPDATED', entityType: 'Site', entityId: siteId, metadata: { scope: 'SITE', thresholdId: row.id, ...this.data(dto) } });
    return this.site(user, siteId);
  }

  async device(user: AuthenticatedUser, deviceId: string) {
    const device = await this.networkDevice(user, deviceId, 'READ');
    const [site, own] = await Promise.all([
      device.siteId ? this.prisma.snmpHealthThreshold.findUnique({ where: { siteId: device.siteId } }) : Promise.resolve(null),
      this.prisma.snmpHealthThreshold.findUnique({ where: { deviceId } }),
    ]) as [OverrideRow | null, OverrideRow | null];
    const effective = effectiveHealthThresholds(site as HealthThresholdOverride | null, own as HealthThresholdOverride | null);
    return { deviceId, siteId: device.siteId, defaults: { ...DEFAULT_HEALTH_THRESHOLDS }, site: this.view(site), device: this.view(own), effective: effective.values, sources: effective.sources };
  }

  async updateDevice(user: AuthenticatedUser, deviceId: string, dto: UpsertSnmpHealthThresholdsDto) {
    await this.networkDevice(user, deviceId, 'UPDATE');
    const data = { ...this.data(dto), updatedById: user.id };
    const row = await this.prisma.snmpHealthThreshold.upsert({ where: { deviceId }, create: { deviceId, ...data }, update: data });
    await this.audit.record({ userId: user.id, action: 'SNMP_HEALTH_THRESHOLDS_UPDATED', entityType: 'Device', entityId: deviceId, metadata: { scope: 'DEVICE', thresholdId: row.id, ...this.data(dto) } });
    return this.device(user, deviceId);
  }

  /** Health samples of the last `hours` (1-720, default 24), oldest first. */
  async history(user: AuthenticatedUser, deviceId: string, hours?: string) {
    const span = hours === undefined || hours === '' ? 24 : Number(hours);
    if (!Number.isInteger(span) || span < 1 || span > HEALTH_HISTORY_RETENTION_DAYS * 24) throw new BadRequestException({ code: 'SNMP_HEALTH_HISTORY_RANGE_INVALID', message: 'O período deve ser entre 1 e 720 horas.' });
    await this.networkDevice(user, deviceId, 'READ');
    const to = new Date();
    const from = new Date(to.getTime() - span * 3_600_000);
    const items = await this.prisma.snmpDeviceHealthSample.findMany({
      where: { deviceId, observedAt: { gte: from } }, orderBy: { observedAt: 'asc' }, take: 10_000,
      select: { observedAt: true, status: true, cpu5sPercent: true, cpu1mPercent: true, cpu5mPercent: true, memoryUsedPercent: true, maxTemperatureCelsius: true, issueCount: true, rebooted: true },
    });
    return { deviceId, from, to, retentionDays: HEALTH_HISTORY_RETENTION_DAYS, items };
  }
}
