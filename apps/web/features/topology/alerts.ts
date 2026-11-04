import type { OperationalAlert, OperationalAlertPage } from '@/features/operations/api';
import type { AssetFile } from '@/features/infrastructure/types';
import type { TopologyNode } from './types';

const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, MEDIUM: 3, LOW: 4, INFO: 5 };
const severityColors: Record<string, string> = { CRITICAL: '#b91c1c', HIGH: '#ea580c', WARNING: '#a16207', MEDIUM: '#a16207', LOW: '#1d4ed8', INFO: '#1d4ed8' };

export const topologySeverityColor = (severity: string) => severityColors[severity] ?? '#475569';
export const topologyDeviceImage = (device?: { frontAsset?: AssetFile | null; model?: { frontAsset?: AssetFile | null } | null } | null) => device?.frontAsset ?? device?.model?.frontAsset ?? null;

export interface TopologyNodeAlertSummary {
  count: number;
  highestSeverity: OperationalAlert['severity'];
  titles: string[];
}

export async function loadAllTopologyAlerts(fetchPage: (page: number) => Promise<OperationalAlertPage>) {
  const first = await fetchPage(1);
  const pages = Math.ceil(first.total / first.pageSize);
  const items = [...first.items];
  for (let start = 2; start <= pages; start += 10) {
    const batch = await Promise.all(Array.from({ length: Math.min(10, pages - start + 1) }, (_, index) => fetchPage(start + index)));
    items.push(...batch.flatMap((page) => page.items));
  }
  return items;
}

export function summarizeTopologyDeviceAlerts(nodes: TopologyNode[], alerts: OperationalAlert[]) {
  const mapNodeIds = new Set(nodes.map((node) => node.deviceId));
  const grouped = new Map<string, OperationalAlert[]>();
  for (const alert of alerts) {
    const deviceId = alert.entityType === 'Device' ? alert.entityId : alert.relatedDeviceId;
    if (!deviceId || !mapNodeIds.has(deviceId) || alert.status === 'RESOLVED') continue;
    const list = grouped.get(deviceId) ?? [];
    list.push(alert);
    grouped.set(deviceId, list);
  }
  return new Map([...grouped].map(([deviceId, items]) => {
    const highest = items.reduce((best, item) => (severityRank[item.severity] ?? 99) < (severityRank[best.severity] ?? 99) ? item : best);
    return [deviceId, { count: items.length, highestSeverity: highest.severity, titles: items.map((item) => item.title) } satisfies TopologyNodeAlertSummary];
  }));
}
