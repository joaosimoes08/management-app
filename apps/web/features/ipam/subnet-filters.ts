/**
 * Subnet list filters that arrive in the URL (dashboard drill-through):
 * `?tab=subnets&band=WARNING,CRITICAL&minUtilization=80&sort=utilization[:asc|desc]|cidr[:asc|desc]`.
 * `sort` is the API's own form (not the table kit's `-column`), so it is kept as a raw value
 * and passed as-is to GET /subnets, which validates everything (400 with a message).
 */
import { hasTableFilters, parseTableState, serializeTableState, type TableStateConfig } from '@/components/data-table';
import { ipamText } from './i18n';

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

const FILTER_BANDS = ['OK', 'WARNING', 'CRITICAL', 'UNTRACKED'];
const bandLabel = (value: string) => (FILTER_BANDS.includes(value.toUpperCase()) ? ipamText(`ipam.filters.band.${value.toUpperCase()}`) : value);

export function subnetFilterLabels(filters: SubnetUrlFilters): string[] {
  const labels: string[] = [];
  if (filters.band) labels.push(ipamText('ipam.filters.band', { bands: filters.band.split(',').map((value) => bandLabel(value.trim())).join(', ') }));
  if (filters.minUtilization) labels.push(ipamText('ipam.filters.minUtilization', { percent: filters.minUtilization }));
  if (filters.sort) labels.push(ipamText(filters.sort.startsWith('cidr') ? 'ipam.filters.sortCidr' : 'ipam.filters.sortUtilization'));
  return labels;
}
