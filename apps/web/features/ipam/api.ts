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
  NetworkMapVlan,
  Subnet,
  SubnetInput,
  SubnetUsage,
  Vlan,
  VlanInput,
  ServiceInput,
  IpamAction,
  IpamPermissionGroup,
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

export function listSubnets(siteId: string): Promise<PaginatedResponse<Subnet>> {
  return apiFetch<PaginatedResponse<Subnet>>(`/api/v1/subnets?siteId=${siteId}&pageSize=200`);
}

export function getSubnet(id: string): Promise<Subnet> {
  return apiFetch<Subnet>(`/api/v1/subnets/${id}`);
}

export function getSubnetUsage(id: string): Promise<SubnetUsage> {
  return apiFetch<SubnetUsage>(`/api/v1/subnets/${id}/usage`);
}

export function listIpAddresses(subnetId: string, search: string): Promise<PaginatedResponse<IpAddressRow>> {
  return apiFetch<PaginatedResponse<IpAddressRow>>(`/api/v1/ip-addresses?subnetId=${subnetId}&pageSize=250&search=${encodeURIComponent(search)}`);
}

export function getHost(id: string): Promise<HostDetail> {
  return apiFetch<HostDetail>(`/api/v1/hosts/${id}`);
}

export function listVlans(siteId: string): Promise<PaginatedResponse<Vlan>> {
  return apiFetch<PaginatedResponse<Vlan>>(`/api/v1/vlans?siteId=${siteId}&pageSize=200`);
}

export function searchHosts(subnetId: string, search: string): Promise<PaginatedResponse<{ id: string }>> {
  return apiFetch<PaginatedResponse<{ id: string }>>(`/api/v1/hosts?subnetId=${subnetId}&search=${encodeURIComponent(search)}`);
}

export function calculateSubnets(body: Omit<CalculatorInput, 'newPrefix'> & { operation: 'split'; newPrefix: number }): Promise<CalculatorResult> {
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

export function createHost(body: HostInput): Promise<HostDetail> {
  return apiFetch<HostDetail>('/api/v1/hosts', { method: 'POST', body: JSON.stringify(body) });
}

export function updateHost(id: string, body: Partial<HostInput>): Promise<HostDetail> {
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

export function deleteService(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/services/${id}`, { method: 'DELETE' });
}
