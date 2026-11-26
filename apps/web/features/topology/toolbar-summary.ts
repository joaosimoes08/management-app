import { translateMessage } from '@/lib/i18n/i18n';

type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string;
const portuguese: Translate = (key, fallback, params) => translateMessage('pt-PT', key, fallback, params);

/** One-line map summary for the topology toolbar; the toolbar truncates it and shows the full text as a tooltip. */
export function topologyToolbarSummary(input: { mapName?: string; nodeCount: number; visibleCount: number; filtering: boolean; connectionCount: number; alertsUnavailable: boolean; problemCount: number }, t: Translate = portuguese): string {
  const devices = input.filtering ? t('groupB.topology.visibleDevices', undefined, { visible: input.visibleCount, total: input.nodeCount }) : t('groupB.topology.devices', undefined, { count: input.nodeCount });
  const problems = input.alertsUnavailable ? t('groupB.topology.alertsUnavailable') : t('groupB.topology.activeProblems', undefined, { count: input.problemCount });
  return t('groupB.topology.summary', undefined, { map: input.mapName ?? t('groupB.topology.noMap'), devices, links: t('groupB.topology.links', undefined, { count: input.connectionCount }), problems });
}
