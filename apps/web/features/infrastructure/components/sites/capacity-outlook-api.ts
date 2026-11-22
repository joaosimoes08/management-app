import { apiFetch } from '@/lib/api/client';
import type { RackPowerThresholds } from '../../api';

export const capacityKinds = ['SUBNET', 'NETAPP_VOLUME', 'NETAPP_AGGREGATE', 'RACK_SPACE', 'RACK_POWER', 'PDU_POWER'] as const;
export type CapacityKind = (typeof capacityKinds)[number];

export interface CapacityOutlookItem {
  kind: CapacityKind;
  id: string;
  name: string;
  rackId?: string;
  rackName?: string;
  source?: 'UPS' | 'SUPPLIER' | null;
  roomId?: string;
  buildingId?: string;
  /** RACK_SPACE: units held for planned installs (Round 2 #18), already counted in currentPercent. */
  reservedUnits?: number;
  currentPercent: number | null;
  trendPer30Days: number | null;
  estimatedAt: string | null;
  observedAt: string | null;
  sampleCount: number;
  status: 'INSUFFICIENT' | 'ALREADY_AT_THRESHOLD' | 'NO_GROWTH' | 'BEYOND_HORIZON' | 'PROJECTED';
  level: 'ok' | 'warning' | 'critical' | null;
}

export interface CapacityOutlook {
  siteId: string;
  thresholds: Required<RackPowerThresholds>;
  historyDays: number;
  items: CapacityOutlookItem[];
}

export function getSiteCapacityOutlook(siteId: string, { warningPercent, criticalPercent }: RackPowerThresholds) {
  const params = new URLSearchParams();
  if (warningPercent !== undefined) params.set('warningPercent', String(warningPercent));
  if (criticalPercent !== undefined) params.set('criticalPercent', String(criticalPercent));
  const suffix = params.size ? `?${params}` : '';
  return apiFetch<CapacityOutlook>(`/api/v1/sites/${encodeURIComponent(siteId)}/capacity-outlook${suffix}`);
}

export function capacityResourceHref(item: CapacityOutlookItem, siteId: string) {
  const params = new URLSearchParams({ siteId });
  if (item.kind === 'NETAPP_VOLUME' || item.kind === 'NETAPP_AGGREGATE') {
    params.set('trendKind', item.kind === 'NETAPP_VOLUME' ? 'VOLUME' : 'AGGREGATE');
    params.set('trendKey', item.id);
    return `/netapp?${params}#netapp-capacity-trend`;
  }
  params.set('rackId', item.rackId ?? item.id);
  if (item.roomId) params.set('roomId', item.roomId);
  if (item.buildingId) params.set('buildingId', item.buildingId);
  if (item.kind === 'PDU_POWER') params.set('pduId', item.id);
  return `/infraestrutura?${params}${item.kind === 'RACK_POWER' ? '#rack-power-summary' : ''}`;
}
