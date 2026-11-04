import type { OperationalAlert } from '@/features/operations/api';
import type { TopologyNode } from './types';

const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, MEDIUM: 3, LOW: 4, INFO: 5 };

export interface TopologyNodeAlertSummary {
  count: number;
  highestSeverity: OperationalAlert['severity'];
  titles: string[];
}

export function summarizeTopologyDeviceAlerts(nodes: TopologyNode[], alerts: OperationalAlert[]) {
  const mapNodeIds = new Set(nodes.map((node) => node.deviceId));
  const grouped = new Map<string, OperationalAlert[]>();
  for (const alert of alerts) {
    if (alert.entityType !== 'Device' || !alert.entityId || !mapNodeIds.has(alert.entityId) || alert.status === 'RESOLVED') continue;
    const list = grouped.get(alert.entityId) ?? [];
    list.push(alert);
    grouped.set(alert.entityId, list);
  }
  return new Map([...grouped].map(([deviceId, items]) => {
    const highest = items.reduce((best, item) => (severityRank[item.severity] ?? 99) < (severityRank[best.severity] ?? 99) ? item : best);
    return [deviceId, { count: items.length, highestSeverity: highest.severity, titles: items.map((item) => item.title) } satisfies TopologyNodeAlertSummary];
  }));
}
