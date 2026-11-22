import { subnetFilterQuery, type SubnetUrlFilters } from './subnet-filters';
import { apiFetch } from '@/lib/api/client';
import type { PaginatedResponse } from '@/lib/api/types';
import { listSites } from '@/features/infrastructure/api';
import type {
  CalculatorInput,
  CalculatorResult,
  HostDetail,
  HostInput,
  IpAddressInput,
  IpAddressRow,
  IpReservation,
  CreateIpReservationInput,
  NetworkMapVlan,
  NextFreeIpsQuery,
  NextFreeIpsResult,
  ReserveNextIpsInput,
  ReserveNextIpsResult,
  Subnet,
  SubnetCapacityHistory,
  SubnetInput,
  SubnetUsage,
  Vlan,
  VlanInput,
  ServiceInput,
  IpamAction,
  IpamPermissionGroup,
  NatRule,
  NatRuleInput,
  NatRuleType,
  RipeImportInput,
  RipeImportRecord,
  RipeImportResult,
  RipePreview,
  RipePreviewInput,
  Vrf,
  VrfDetail,
  VrfInput,
} from './types';

export function listPermissionGroups(siteId?: string): Promise<IpamPermissionGroup[]> {
  return apiFetch<IpamPermissionGroup[]>(`/api/v1/settings/access-groups${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
}

export function updateGroupSitePermissions(groupId: string, siteId: string, permissions: IpamAction[]): Promise<unknown> {
  return apiFetch(`/api/v1/settings/access-groups/${groupId}/sites/${siteId}`, { method: 'PUT', body: JSON.stringify({ permissions }) });
}

export { listSites };

// ── Reads ──────────────────────────────────────────────────────────────────

export function getNetworkMap(siteId: string): Promise<{ vlans: NetworkMapVlan[] }> {
  return apiFetch<{ vlans: NetworkMapVlan[] }>(`/api/v1/sites/${siteId}/network-map`);
}

/** The API caps pageSize at 100, so every page is fetched and merged: pickers and lookups need the whole Site. */
export const SUBNET_PAGE_SIZE = 100;
/** `filters` are the optional drill-through filters (band, minUtilization, sort). */
export async function listSubnets(siteId: string, filters?: Partial<SubnetUrlFilters>): Promise<PaginatedResponse<Subnet>> {
  const path = (page: number) => `/api/v1/subnets?siteId=${siteId}&page=${page}&pageSize=${SUBNET_PAGE_SIZE}${subnetFilterQuery(filters)}`;
  const first = await apiFetch<PaginatedResponse<Subnet>>(path(1));
  const totalPages = Math.max(first.totalPages ?? 1, 1);
  if (totalPages === 1) return first;
  const rest = await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => apiFetch<PaginatedResponse<Subnet>>(path(index + 2))));
  const items = [first, ...rest].flatMap((page) => page.items);
  return { ...first, items, page: 1, pageSize: items.length, totalPages: 1 };
}

export function getSubnet(id: string): Promise<Subnet> {
  return apiFetch<Subnet>(`/api/v1/subnets/${id}`);
}

export function getSubnetUsage(id: string): Promise<SubnetUsage> {
  return apiFetch<SubnetUsage>(`/api/v1/subnets/${id}/usage`);
}

export function getSubnetCapacityHistory(id: string): Promise<SubnetCapacityHistory> {
  return apiFetch<SubnetCapacityHistory>(`/api/v1/subnets/${id}/capacity-history`);
}

export type SubnetPlanning = { subnet: Subnet; version: number; network?: string; broadcast?: string; usableRange?: { start: string; end: string } | null; usableTotal?: number; unavailable?: number; free?: number; utilizationPercent: number | null; usableGaps: Array<{ start: string; end: string; count: number }>; unavailableAddresses?: string[]; message?: string };
export function getSubnetPlanning(id: string): Promise<SubnetPlanning> {
  return apiFetch<SubnetPlanning>(`/api/v1/subnets/${id}/planning`);
}
export function getIpAddress(id: string): Promise<IpAddressRow> {
  return apiFetch<IpAddressRow>(`/api/v1/ip-addresses/${id}`);
}

/** Page size of a subnet's IP list: the most the API returns per page (it caps pageSize at 200). */
export const IP_LIST_PAGE_SIZE = 200;

export function listIpAddresses(subnetId: string, search: string, page = 1): Promise<PaginatedResponse<IpAddressRow>> {
  return apiFetch<PaginatedResponse<IpAddressRow>>(`/api/v1/ip-addresses?subnetId=${subnetId}&page=${page}&pageSize=${IP_LIST_PAGE_SIZE}&search=${encodeURIComponent(search)}`);
}

export function getHost(id: string): Promise<HostDetail> {
  return apiFetch<HostDetail>(`/api/v1/hosts/${id}`);
}

export interface IpCheckHistoryEntry { id: string; createdAt: string; metadata?: { reachable?: boolean } | null; user?: { displayName?: string | null; username?: string | null } | null }
export function getIpCheckHistory(id: string, page = 1): Promise<PaginatedResponse<IpCheckHistoryEntry>> {
  return apiFetch<PaginatedResponse<IpCheckHistoryEntry>>(`/api/v1/ip-addresses/${id}/check-history?page=${page}&pageSize=20`);
}
export function checkIpAddress(id: string): Promise<IpAddressRow & { lastCheckAt?: string | null; lastCheckMethod?: string | null; responseMs?: number | null }> {
  return apiFetch(`/api/v1/ip-addresses/${id}/check`, { method: 'POST' });
}

export function listVlans(siteId: string): Promise<PaginatedResponse<Vlan>> {
  return apiFetch<PaginatedResponse<Vlan>>(`/api/v1/vlans?siteId=${siteId}&pageSize=200`);
}

export function searchHosts(subnetId: string, search: string): Promise<PaginatedResponse<{ id: string }>> {
  return apiFetch<PaginatedResponse<{ id: string }>>(`/api/v1/hosts?subnetId=${subnetId}&search=${encodeURIComponent(search)}`);
}

export function calculateSubnets(body: Omit<CalculatorInput, 'newPrefix' | 'containsAddress' | 'cidrsText'> & { operation: 'split'; newPrefix: number } | { operation: 'summary'; cidr: string } | { operation: 'contains'; cidr: string; address: string } | { operation: 'overlap'; cidr: string; cidrs: string[] }): Promise<CalculatorResult> {
  return apiFetch<CalculatorResult>('/api/v1/ipam/calculator', { method: 'POST', body: JSON.stringify(body) });
}

// ── Writes ─────────────────────────────────────────────────────────────────

export function createVlan(body: VlanInput): Promise<Vlan> {
  return apiFetch<Vlan>('/api/v1/vlans', { method: 'POST', body: JSON.stringify(body) });
}

export function updateVlan(id: string, body: Partial<VlanInput>): Promise<Vlan> {
  return apiFetch<Vlan>(`/api/v1/vlans/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteVlan(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/vlans/${id}`, { method: 'DELETE' });
}

export function createSubnet(body: SubnetInput): Promise<Subnet> {
  return apiFetch<Subnet>('/api/v1/subnets', { method: 'POST', body: JSON.stringify(body) });
}

export function createIpAddress(body: IpAddressInput): Promise<IpAddressRow> {
  return apiFetch<IpAddressRow>('/api/v1/ip-addresses', { method: 'POST', body: JSON.stringify(body) });
}

export function updateIpAddress(id: string, body: Partial<IpAddressInput>): Promise<IpAddressRow> {
  return apiFetch<IpAddressRow>(`/api/v1/ip-addresses/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function createIpReservation(ipAddressId: string, body: CreateIpReservationInput): Promise<IpReservation> {
  return apiFetch<IpReservation>('/api/v1/ip-reservations', { method: 'POST', body: JSON.stringify({ ipAddressId, ...body }) });
}

export function releaseIpReservation(id: string): Promise<{ success: boolean; released: boolean }> {
  return apiFetch<{ success: boolean; released: boolean }>(`/api/v1/ip-reservations/${id}/release`, { method: 'POST' });
}

/** Next free addresses of a subnet (read-only; IPv6 answers supported:false). */
export function getNextFreeIps(subnetId: string, query: NextFreeIpsQuery = {}): Promise<NextFreeIpsResult> {
  const params = new URLSearchParams();
  if (query.count) params.set('count', String(query.count));
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const suffix = params.toString();
  return apiFetch<NextFreeIpsResult>(`/api/v1/subnets/${subnetId}/next-free${suffix ? `?${suffix}` : ''}`);
}

/** Atomically reserves the next free addresses of a subnet (409 IP_RANGE_EXHAUSTED / IP_RANGE_CHANGED). */
export function reserveNextIps(subnetId: string, body: ReserveNextIpsInput): Promise<ReserveNextIpsResult> {
  const payload: ReserveNextIpsInput = { count: body.count ?? 1, durationHours: body.durationHours, reason: body.reason };
  if (body.from) payload.from = body.from;
  if (body.to) payload.to = body.to;
  return apiFetch<ReserveNextIpsResult>(`/api/v1/subnets/${subnetId}/reserve-next`, { method: 'POST', body: JSON.stringify(payload) });
}

export function createHost(body: HostInput): Promise<HostDetail> {
  return apiFetch<HostDetail>('/api/v1/hosts', { method: 'POST', body: JSON.stringify(body) });
}

export function updateHost(id: string, body: Partial<{ [Key in keyof HostInput]: HostInput[Key] | null }>): Promise<HostDetail> {
  return apiFetch<HostDetail>(`/api/v1/hosts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteHost(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/hosts/${id}`, { method: 'DELETE' });
}

export function unlinkHostIpAddress(hostId: string, ipId: string): Promise<unknown> {
  return apiFetch(`/api/v1/hosts/${hostId}/ip-addresses/${ipId}`, { method: 'DELETE' });
}

export function createService(body: ServiceInput): Promise<unknown> {
  return apiFetch('/api/v1/services', { method: 'POST', body: JSON.stringify(body) });
}

export function updateService(id: string, body: Partial<{ [Key in keyof Omit<ServiceInput, 'hostId'>]: Omit<ServiceInput, 'hostId'>[Key] | null }>): Promise<unknown> {
  return apiFetch(`/api/v1/services/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteService(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/services/${id}`, { method: 'DELETE' });
}

// ── VRFs ───────────────────────────────────────────────────────────────────

export function listVrfs(siteId: string): Promise<Vrf[]> {
  return apiFetch<Vrf[]>(`/api/v1/vrfs?siteId=${encodeURIComponent(siteId)}`);
}

export function getVrf(id: string): Promise<VrfDetail> {
  return apiFetch<VrfDetail>(`/api/v1/vrfs/${id}`);
}

export function createVrf(body: VrfInput): Promise<Vrf> {
  return apiFetch<Vrf>('/api/v1/vrfs', { method: 'POST', body: JSON.stringify(body) });
}

export function updateVrf(id: string, body: VrfInput): Promise<Vrf> {
  return apiFetch<Vrf>(`/api/v1/vrfs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteVrf(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/vrfs/${id}`, { method: 'DELETE' });
}

// ── NAT rules ──────────────────────────────────────────────────────────────

export function listNatRules(siteId: string, filters: { vrfId?: string; type?: NatRuleType | '' } = {}): Promise<NatRule[]> {
  const params = new URLSearchParams({ siteId });
  if (filters.vrfId) params.set('vrfId', filters.vrfId);
  if (filters.type) params.set('type', filters.type);
  return apiFetch<NatRule[]>(`/api/v1/nat-rules?${params.toString()}`);
}

export function createNatRule(body: NatRuleInput): Promise<NatRule> {
  return apiFetch<NatRule>('/api/v1/nat-rules', { method: 'POST', body: JSON.stringify(body) });
}

export function updateNatRule(id: string, body: NatRuleInput): Promise<NatRule> {
  return apiFetch<NatRule>(`/api/v1/nat-rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteNatRule(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/nat-rules/${id}`, { method: 'DELETE' });
}

// ── RIPE ───────────────────────────────────────────────────────────────────

/** RIPEstat lookup (query) or pasted/uploaded list (prefixes, raw text), diffed server-side against target.siteId/vrfId. */
export function previewRipe(body: RipePreviewInput): Promise<RipePreview> {
  return apiFetch<RipePreview>('/api/v1/ipam/ripe/preview', { method: 'POST', body: JSON.stringify(body) });
}

export function importRipe(body: RipeImportInput): Promise<RipeImportResult> {
  return apiFetch<RipeImportResult>('/api/v1/ipam/ripe/import', { method: 'POST', body: JSON.stringify(body) });
}

export function listRipeImports(): Promise<RipeImportRecord[]> {
  return apiFetch<RipeImportRecord[]>('/api/v1/ipam/ripe/imports');
}

export function getRipeImport(id: string): Promise<RipeImportRecord> {
  return apiFetch<RipeImportRecord>(`/api/v1/ipam/ripe/imports/${id}`);
}
