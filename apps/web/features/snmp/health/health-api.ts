import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';

/** SNMP Phase 2 step 10: types and queries for the device health badges and the Device 360 health panel. */
export type SnmpHealthStatus = 'OK' | 'DEGRADED' | 'UNKNOWN';
export type EnvironmentState = 'normal' | 'warning' | 'critical' | 'shutdown' | 'notPresent' | 'notFunctioning' | 'unknown';
export type HealthSection = 'entity' | 'interfaces' | 'cpu' | 'memory' | 'environment' | 'stack';

/** One line of GET /api/v1/snmp/health. `status` null = no reading yet ("Sem dados"). */
export interface SnmpHealthSummaryItem {
  deviceId: string;
  status: SnmpHealthStatus | null;
  observedAt: string | null;
  issueCount: number;
  rebootDetectedAt: string | null;
  stale: boolean;
}

/** Full reading from GET /api/v1/snmp/devices/:deviceId/health (contract in PR #160). BigInt values are strings. */
export interface SnmpDeviceHealth {
  vendor: string;
  status: SnmpHealthStatus;
  observedAt: string;
  jobId: string | null;
  uptimeTicks: string | null;
  bootedAt: string | null;
  rebootDetectedAt: string | null;
  rebootCount: number;
  cpu: { fiveSecondPercent: number | null; oneMinutePercent: number | null; fiveMinutePercent: number | null };
  memory: { usedPercent: number | null; usedBytes: string | null; totalBytes: string | null };
  issueCount: number;
  details: Partial<{
    temperatures: Array<{ index: number; description: string | null; celsius: number | null; thresholdCelsius: number | null; state: EnvironmentState }>;
    fans: Array<{ index: number; description: string | null; state: EnvironmentState }>;
    powerSupplies: Array<{ index: number; description: string | null; state: EnvironmentState; source: string | null }>;
    stack: { ringRedundant: boolean | null; members: Array<{ index: number; switchNumber: number | null; name: string | null; role: string; state: string; ready: boolean }> } | null;
    issues: Array<{ code: string; component: string; state: string }>;
    unavailable: HealthSection[];
  }> | null;
}

export const SNMP_HEALTH_ROLES = ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'];
export const SNMP_NETWORK_TYPES = ['SWITCH', 'ROUTER', 'FIREWALL'];
export const isSnmpNetworkDevice = (type?: string | null) => SNMP_NETWORK_TYPES.includes(String(type ?? ''));

export const getSnmpDeviceHealth = (deviceId: string) => apiFetch<{ deviceId: string; health: SnmpDeviceHealth | null }>(`/api/v1/snmp/devices/${encodeURIComponent(deviceId)}/health`);
export const getSnmpHealthSummary = (siteId?: string) => apiFetch<{ siteId: string | null; items: SnmpHealthSummaryItem[] }>(`/api/v1/snmp/health${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);

export const snmpHealthSummaryKey = (siteId?: string) => ['snmp', 'health-summary', siteId ?? ''] as const;

/** True when the signed-in user may read SNMP health (the API answers 403 to the other roles). */
export function useCanReadSnmpHealth() {
  const { hasRole } = useAuth();
  return SNMP_HEALTH_ROLES.some((role) => hasRole(role));
}

/**
 * Health of every visible network device in a Site (or all visible Sites when siteId is empty), fetched once and
 * shared by the device list, the rack and the topology: one request per Site instead of one per row. Undefined for
 * users without the SNMP read role (the API would answer 403), so no badge is drawn for them.
 */
export function useSnmpHealthMap(siteId: string | undefined, enabled = true): ReadonlyMap<string, SnmpHealthSummaryItem> | undefined {
  const canRead = useCanReadSnmpHealth();
  const { data } = useQuery({ queryKey: snmpHealthSummaryKey(siteId), queryFn: () => getSnmpHealthSummary(siteId), enabled: enabled && canRead, staleTime: 30_000, refetchInterval: 60_000, retry: false });
  // Without the SNMP read role there is no map at all, so lists, racks and pickers show no badge instead of "Sem dados".
  return useMemo(() => (canRead ? new Map((data?.items ?? []).map((item) => [item.deviceId, item])) : undefined), [canRead, data]);
}
