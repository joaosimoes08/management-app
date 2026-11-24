import { apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';

/** SNMP Phase 2 step 9 UI: health alert limits (per Site, per device) and the 30-day health history. Contract in PR #174. */
export const LIMIT_FIELDS = ['cpuPercent', 'cpuSustainMinutes', 'memoryPercent', 'temperatureHighCelsius', 'temperatureCriticalCelsius', 'interfaceErrorsPerMinute'] as const;
export type LimitField = typeof LIMIT_FIELDS[number];
export type Limits = Record<LimitField, number | null>;
export type LimitOverride = Limits & { updatedAt: string; updatedById: string | null };
export type LimitSource = 'DEFAULT' | 'SITE' | 'DEVICE';

export interface SiteHealthThresholds { siteId: string; defaults: Limits; site: LimitOverride | null; effective: Limits; sources: Record<LimitField, LimitSource> }
export interface DeviceHealthThresholds { deviceId: string; siteId: string | null; defaults: Limits; site: LimitOverride | null; device: LimitOverride | null; effective: Limits; sources: Record<LimitField, LimitSource> }

export interface HealthHistoryItem {
  observedAt: string;
  status: 'OK' | 'DEGRADED' | 'UNKNOWN';
  cpu5sPercent: number | null; cpu1mPercent: number | null; cpu5mPercent: number | null;
  memoryUsedPercent: number | null; maxTemperatureCelsius: number | null;
  issueCount: number; rebooted: boolean;
}
export interface HealthHistory { deviceId: string; from: string; to: string; retentionDays: number; items: HealthHistoryItem[] }

/** API ranges (400 outside them). `integer` fields refuse decimals. */
export const LIMIT_RULES: Record<LimitField, { min: number; max: number; step: number; integer?: boolean; unit: string }> = {
  cpuPercent: { min: 1, max: 100, step: 1, unit: '%' },
  cpuSustainMinutes: { min: 1, max: 60, step: 1, integer: true, unit: 'min' },
  memoryPercent: { min: 1, max: 100, step: 1, unit: '%' },
  temperatureHighCelsius: { min: -40, max: 150, step: 1, unit: '°C' },
  temperatureCriticalCelsius: { min: -40, max: 150, step: 1, unit: '°C' },
  interfaceErrorsPerMinute: { min: 0.1, max: 1_000_000, step: 0.1, unit: '/min' },
};

export const HISTORY_RANGES = [{ id: '24h', hours: 24 }, { id: '7d', hours: 168 }, { id: '30d', hours: 720 }] as const;
export type HistoryRangeId = typeof HISTORY_RANGES[number]['id'];

const id = (value: string) => encodeURIComponent(value);
export const getHealthThresholdDefaults = () => apiFetch<{ defaults: Limits; historyRetentionDays: number }>('/api/v1/snmp/health-thresholds/defaults');
export const getSiteHealthThresholds = (siteId: string) => apiFetch<SiteHealthThresholds>(`/api/v1/snmp/sites/${id(siteId)}/health-thresholds`);
export const putSiteHealthThresholds = (siteId: string, body: Partial<Limits>) => apiFetch<SiteHealthThresholds>(`/api/v1/snmp/sites/${id(siteId)}/health-thresholds`, { method: 'PUT', body: JSON.stringify(body) });
export const getDeviceHealthThresholds = (deviceId: string) => apiFetch<DeviceHealthThresholds>(`/api/v1/snmp/devices/${id(deviceId)}/health-thresholds`);
export const putDeviceHealthThresholds = (deviceId: string, body: Partial<Limits>) => apiFetch<DeviceHealthThresholds>(`/api/v1/snmp/devices/${id(deviceId)}/health-thresholds`, { method: 'PUT', body: JSON.stringify(body) });
export const getDeviceHealthHistory = (deviceId: string, hours: number) => apiFetch<HealthHistory>(`/api/v1/snmp/devices/${id(deviceId)}/health/history?hours=${hours}`);

export const siteHealthThresholdsKey = (siteId: string) => ['snmp', 'health-thresholds', 'site', siteId] as const;
export const deviceHealthThresholdsKey = (deviceId: string) => ['snmp', 'health-thresholds', 'device', deviceId] as const;
export const deviceHealthHistoryKey = (deviceId: string, hours: number) => ['snmp', 'health-history', deviceId, hours] as const;

export const HEALTH_THRESHOLD_EDIT_ROLES = ['ADMIN', 'NETWORK_OPERATOR'];
export const HEALTH_THRESHOLD_READ_ROLES = ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'];

/** ADMIN and NETWORK_OPERATOR may change limits; the API answers 403 to everyone else. */
export function useCanEditHealthThresholds() {
  const { hasRole } = useAuth();
  return HEALTH_THRESHOLD_EDIT_ROLES.some((role) => hasRole(role));
}

/** A form draft: one string per field, '' = inherit. */
export type LimitDraft = Record<LimitField, string>;
export const draftFrom = (override: Limits | null): LimitDraft => Object.fromEntries(LIMIT_FIELDS.map((field) => [field, override?.[field] === null || override?.[field] === undefined ? '' : String(override[field])])) as LimitDraft;

export type LimitError = { field: LimitField; key: 'range' | 'integer' | 'temperatureOrder' };

/**
 * Turns a draft into the PUT body (only the fields set; PUT replaces the whole override, omitted = inherit) and lists
 * what the API would refuse, so the form can say it next to the field instead of after a 400.
 */
export function bodyFromDraft(draft: LimitDraft): { body: Partial<Limits>; errors: LimitError[] } {
  const body: Partial<Limits> = {};
  const errors: LimitError[] = [];
  for (const field of LIMIT_FIELDS) {
    const raw = draft[field].trim().replace(',', '.');
    if (!raw) continue;
    const value = Number(raw);
    const rule = LIMIT_RULES[field];
    if (!Number.isFinite(value) || value < rule.min || value > rule.max) { errors.push({ field, key: 'range' }); continue; }
    if (rule.integer && !Number.isInteger(value)) { errors.push({ field, key: 'integer' }); continue; }
    body[field] = value;
  }
  if (body.temperatureHighCelsius !== undefined && body.temperatureCriticalCelsius !== undefined && body.temperatureCriticalCelsius! < body.temperatureHighCelsius!) {
    errors.push({ field: 'temperatureCriticalCelsius', key: 'temperatureOrder' });
  }
  return { body, errors };
}

/** CPU figure the alert uses: 5-minute average, else 1-minute, else 5-second (PR #174 note 1). */
export const historyCpu = (item: HealthHistoryItem) => item.cpu5mPercent ?? item.cpu1mPercent ?? item.cpu5sPercent;
