import { apiFetch } from '@/lib/api/client';
import type { TopologyConnection, TopologyMap, TopologyMapType, TopologyNode } from './types';
export async function listTopologyConnections(siteId: string): Promise<{ items: TopologyConnection[]; total: number }> {
  const first = await apiFetch<{ items: TopologyConnection[]; total: number; pageSize: number }>(`/api/v1/topology/connections?siteId=${encodeURIComponent(siteId)}&pageSize=100`);
  const items = [...first.items];
  const pages = Math.ceil(first.total / first.pageSize);
  for (let page = 2; page <= pages; page++) items.push(...(await apiFetch<{ items: TopologyConnection[] }>(`/api/v1/topology/connections?siteId=${encodeURIComponent(siteId)}&page=${page}&pageSize=100`)).items);
  return { items, total: first.total };
}
export const listTopologyMaps = (siteId?: string) => apiFetch<{ items: TopologyMap[]; total: number }>(`/api/v1/topology/maps${siteId ? `?siteId=${encodeURIComponent(siteId)}&pageSize=100` : '?pageSize=100'}`);
export const getTopologyMap = (id: string) => apiFetch<TopologyMap>(`/api/v1/topology/maps/${id}`);
export const createTopologyMap = (body: { name: string; type: TopologyMapType; siteId: string; filters?: { vlanIds: string[] } }) => apiFetch<TopologyMap>('/api/v1/topology/maps', { method: 'POST', body: JSON.stringify(body) });
export const updateTopologyMap = (id: string, body: Partial<Pick<TopologyMap, 'name' | 'type'>> & { expectedRevision: number }) => apiFetch<TopologyMap>(`/api/v1/topology/maps/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteTopologyMap = (id: string, revision?: number) => apiFetch(`/api/v1/topology/maps/${id}${revision === undefined ? '' : `?revision=${revision}`}`, { method: 'DELETE' });
export const replaceTopologyNodes = (id: string, revision: number, nodes: TopologyNode[]) => apiFetch<TopologyMap>(`/api/v1/topology/maps/${id}/nodes`, { method: 'PUT', body: JSON.stringify({ revision, nodes: nodes.map((node) => ({ deviceId: node.deviceId, x: node.x, y: node.y, label: node.label })) }) });
export const createTopologyConnection = (id: string, body: { sourceNodeId: string; targetNodeId: string; revision: number; sourceInterfaceId?: string; targetInterfaceId?: string; type?: 'PHYSICAL' | 'LOGICAL'; label?: string }) => apiFetch<TopologyConnection>(`/api/v1/topology/maps/${id}/connections`, { method: 'POST', body: JSON.stringify({ ...body, sourceDeviceId: body.sourceNodeId.split(':').pop(), targetDeviceId: body.targetNodeId.split(':').pop() }) });
export const updateTopologyConnection = (connectionId: string, body: { label?: string; notes?: string; type?: 'PHYSICAL' | 'LOGICAL'; expectedRevisions?: Record<string, number> }) => apiFetch<TopologyConnection>(`/api/v1/topology/connections/${connectionId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteTopologyConnection = (mapId: string, connectionId: string, revision: number) => apiFetch(`/api/v1/topology/maps/${mapId}/connections/${connectionId}?revision=${revision}`, { method: 'DELETE' });
