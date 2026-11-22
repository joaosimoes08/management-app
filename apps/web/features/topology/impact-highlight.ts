import type { TopologyImpact, TopologyPath } from './impact-api';
import type { TopologyMap } from './types';

export type ImpactNodeState = 'down' | 'cut' | 'degraded' | 'path';
export type ImpactEdgeState = 'down' | 'cut' | 'path';
export type MapHighlight = {
  nodes: Map<string, ImpactNodeState>;
  edges: Map<string, ImpactEdgeState>;
  /** Highlighted devices that are not drawn on this map. */
  offMap: number;
};

type MapShape = Pick<TopologyMap, 'nodes' | 'connections'>;

/**
 * Map node / edge ids to mark for an impact result. Map edges carry the same ids as the documented
 * DeviceConnection rows the API walks, so `viaConnectionId` matches them directly.
 * - down: the device itself, every device of a failed rack, or devices whose every feed is on a failed PDU
 * - cut: devices that lose every documented path to the site gateways
 * - degraded: dual-fed devices that lose one feed (still up)
 */
export function impactHighlight(impact: TopologyImpact, map: MapShape): MapHighlight {
  const deviceState = new Map<string, ImpactNodeState>();
  for (const device of impact.powerDegraded) deviceState.set(device.id, 'degraded');
  for (const device of impact.affected) deviceState.set(device.id, 'cut');
  for (const device of impact.down) deviceState.set(device.id, 'down');
  const viaConnections = new Set(impact.affected.map((device) => device.viaConnectionId).filter((id): id is string => Boolean(id)));

  const nodes = new Map<string, ImpactNodeState>();
  const onMap = new Set<string>();
  for (const node of map.nodes) {
    const state = deviceState.get(node.deviceId);
    if (state) { nodes.set(node.id, state); onMap.add(node.deviceId); }
  }
  const edges = new Map<string, ImpactEdgeState>();
  for (const connection of map.connections) {
    const source = deviceState.get(connection.sourceDeviceId);
    const target = deviceState.get(connection.targetDeviceId);
    if (source === 'down' || target === 'down') edges.set(connection.id, 'down');
    else if (viaConnections.has(connection.id) || (source === 'cut' && target === 'cut')) edges.set(connection.id, 'cut');
  }
  return { nodes, edges, offMap: [...deviceState.keys()].filter((id) => !onMap.has(id)).length };
}

/** Map node / edge ids on the shortest documented path. Hidden steps (outside the caller's scope) are skipped. */
export function pathHighlight(path: TopologyPath, map: MapShape): MapHighlight {
  const deviceIds = new Set(path.steps.flatMap((step) => (step.hidden ? [] : [step.id])));
  const connectionIds = new Set(path.connections.flatMap((link) => (link.hidden ? [] : [link.id])));
  const nodes = new Map<string, ImpactNodeState>();
  const onMap = new Set<string>();
  for (const node of map.nodes) if (deviceIds.has(node.deviceId)) { nodes.set(node.id, 'path'); onMap.add(node.deviceId); }
  const edges = new Map<string, ImpactEdgeState>();
  for (const connection of map.connections) if (connectionIds.has(connection.id)) edges.set(connection.id, 'path');
  return { nodes, edges, offMap: [...deviceIds].filter((id) => !onMap.has(id)).length };
}

/** Adds the highlight class to every node / edge, and dims the rest so the affected set stands out. */
export function withHighlightClasses<T extends { id: string; className?: string }>(items: T[], states: Map<string, string> | null, prefix: 'node' | 'edge'): T[] {
  if (!states) return items;
  return items.map((item) => {
    const state = states.get(item.id);
    const extra = state ? `topology-${prefix}--impact topology-${prefix}--impact-${state}` : `topology-${prefix}--dimmed`;
    return { ...item, className: item.className ? `${item.className} ${extra}` : extra };
  });
}
