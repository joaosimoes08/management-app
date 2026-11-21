import type { TopologyNodeAlertSummary } from './alerts';
import type { TopologyNode } from './types';

/**
 * Front-end filters for a topology map. A map belongs to one Site, so the
 * "site" dimension is the device location inside it (building · room).
 */
export type TopologyProblemFilter = '' | 'problem' | 'critical' | 'healthy';
export type TopologyFilters = { type: string; location: string; problem: TopologyProblemFilter };

export const emptyTopologyFilters: TopologyFilters = { type: '', location: '', problem: '' };
export const NO_LOCATION = '__none__';

export const topologyTypeLabels: Record<string, string> = {
  SWITCH: 'Switch',
  ROUTER: 'Router',
  FIREWALL: 'Firewall',
  SERVER: 'Servidor',
  STORAGE: 'Armazenamento',
  OTHER: 'Outro',
};

export const topologyProblemOptions: Array<[TopologyProblemFilter, string]> = [
  ['', 'Todos os estados'],
  ['problem', 'Com alertas ativos'],
  ['critical', 'Com alertas críticos'],
  ['healthy', 'Sem alertas ativos'],
];

/** Severities shown in the legend, most severe first (same colours as the node badges). */
export const topologyLegendSeverities: Array<[string, string]> = [
  ['CRITICAL', 'Crítico'],
  ['HIGH', 'Alto'],
  ['WARNING', 'Aviso / médio'],
  ['LOW', 'Baixo / informativo'],
];

export const topologyTypeLabel = (type: string) => topologyTypeLabels[type] ?? type;
export const nodeType = (node: TopologyNode) => String(node.device?.type || 'OTHER').toUpperCase();
export const nodeLocation = (node: TopologyNode) => [node.device?.rack?.room?.building?.name, node.device?.rack?.room?.name].filter(Boolean).join(' · ') || NO_LOCATION;

export type TopologyFilterOption = { value: string; label: string; count: number };

const countBy = (nodes: TopologyNode[], key: (node: TopologyNode) => string) => {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(key(node), (counts.get(key(node)) ?? 0) + 1);
  return counts;
};

/** Types present on the map with their node counts (also used by the legend). */
export function topologyTypeOptions(nodes: TopologyNode[]): TopologyFilterOption[] {
  const order = Object.keys(topologyTypeLabels);
  return [...countBy(nodes, nodeType)]
    .map(([value, count]) => ({ value, label: topologyTypeLabel(value), count }))
    .sort((a, b) => (order.indexOf(a.value) + 1 || 99) - (order.indexOf(b.value) + 1 || 99) || a.label.localeCompare(b.label));
}

/** Locations present on the map; devices without a rack are grouped as "Sem localização" (last). */
export function topologyLocationOptions(nodes: TopologyNode[]): TopologyFilterOption[] {
  return [...countBy(nodes, nodeLocation)]
    .map(([value, count]) => ({ value, label: value === NO_LOCATION ? 'Sem localização' : value, count }))
    .sort((a, b) => (a.value === NO_LOCATION ? 1 : 0) - (b.value === NO_LOCATION ? 1 : 0) || a.label.localeCompare(b.label));
}

export const hasTopologyFilters = (filters: TopologyFilters) => Boolean(filters.type || filters.location || filters.problem);
export const activeTopologyFilterCount = (filters: TopologyFilters) => [filters.type, filters.location, filters.problem].filter(Boolean).length;

function matchesProblem(summary: TopologyNodeAlertSummary | undefined, problem: TopologyProblemFilter) {
  const active = Boolean(summary && summary.count > 0);
  if (problem === 'problem') return active;
  if (problem === 'critical') return active && summary!.highestSeverity === 'CRITICAL';
  if (problem === 'healthy') return !active;
  return true;
}

/** Ids of the map nodes the filters hide. Alert summaries are keyed by device id. */
export function hiddenTopologyNodeIds(nodes: TopologyNode[], filters: TopologyFilters, alerts: ReadonlyMap<string, TopologyNodeAlertSummary>): Set<string> {
  const hidden = new Set<string>();
  if (!hasTopologyFilters(filters)) return hidden;
  for (const node of nodes) {
    const visible = (!filters.type || nodeType(node) === filters.type)
      && (!filters.location || nodeLocation(node) === filters.location)
      && matchesProblem(alerts.get(node.deviceId), filters.problem);
    if (!visible) hidden.add(node.id);
  }
  return hidden;
}

/** Marks hidden nodes (keeping the same object when nothing changes, so React Flow does not re-measure). */
export function withHiddenNodes<N extends { id: string; hidden?: boolean }>(nodes: N[], hidden: ReadonlySet<string>): N[] {
  return nodes.map((node) => {
    const hide = hidden.has(node.id);
    return Boolean(node.hidden) === hide ? node : { ...node, hidden: hide };
  });
}

/** Hides every edge with a hidden end. */
export function withHiddenEdges<E extends { source: string; target: string; hidden?: boolean }>(edges: E[], hidden: ReadonlySet<string>): E[] {
  return edges.map((edge) => {
    const hide = hidden.has(edge.source) || hidden.has(edge.target);
    return Boolean(edge.hidden) === hide ? edge : { ...edge, hidden: hide };
  });
}
