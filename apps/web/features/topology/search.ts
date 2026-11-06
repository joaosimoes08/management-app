import type { TopologyNode } from './types';

export function findTopologyNode(nodes: TopologyNode[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return nodes.find((node) => [node.label, node.device?.name, node.device?.managementIp, node.device?.type]
    .some((value) => value?.toLocaleLowerCase().includes(normalized)));
}
