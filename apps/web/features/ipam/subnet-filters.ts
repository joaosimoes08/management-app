/**
 * Subnet list filters that arrive in the URL (dashboard drill-through):
 * `?tab=subnets&band=WARNING,CRITICAL&minUtilization=80&sort=utilization[:asc|desc]|cidr[:asc|desc]`.
 * `sort` is the API's own form (not the table kit's `-column`), so it is kept as a raw value
 * and passed as-is to GET /subnets, which validates everything (400 with a message).
 */
import { hasTableFilters, parseTableState, serializeTableState, type TableStateConfig } from '@/components/data-table';

export type SubnetUrlFilters = { band: string; minUtilization: string; sort: string };
export const emptySubnetUrlFilters: SubnetUrlFilters = { band: '', minUtilization: '', sort: '' };
export const subnetUrlConfig: TableStateConfig<SubnetUrlFilters> = { filters: emptySubnetUrlFilters, sortable: [], searchKey: 'subnetSearch' };

export const readSubnetUrlFilters = (query: string): SubnetUrlFilters => parseTableState(query, subnetUrlConfig).filters;
export const hasSubnetUrlFilters = (filters: SubnetUrlFilters) => hasTableFilters({ search: '', filters }, emptySubnetUrlFilters);
export const clearSubnetUrlFilters = (query: string) => serializeTableState(query, { search: '', filters: emptySubnetUrlFilters, sort: null }, subnetUrlConfig);

/** `&band=…&minUtilization=…&sort=…` for GET /subnets; empty when there are no filters. */
export function subnetFilterQuery(filters: Partial<SubnetUrlFilters> = {}): string {
  return (Object.keys(emptySubnetUrlFilters) as Array<keyof SubnetUrlFilters>)
    .filter((key) => filters[key])
    .map((key) => `&${key}=${encodeURIComponent(filters[key]!)}`)
    .join('');
}

const bandLabels: Record<string, string> = { OK: 'Normal', WARNING: 'Aviso (≥ 80%)', CRITICAL: 'Crítico (≥ 90%)', UNTRACKED: 'Sem cálculo (IPv6)' };

export function subnetFilterLabels(filters: SubnetUrlFilters): string[] {
  const labels: string[] = [];
  if (filters.band) labels.push(`Ocupação: ${filters.band.split(',').map((value) => bandLabels[value.trim().toUpperCase()] ?? value.trim()).join(', ')}`);
  if (filters.minUtilization) labels.push(`Ocupação mínima: ${filters.minUtilization}%`);
  if (filters.sort) labels.push(filters.sort.startsWith('cidr') ? 'Ordenadas por CIDR' : 'Ordenadas por ocupação');
  return labels;
}
