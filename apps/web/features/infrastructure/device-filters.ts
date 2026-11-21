/**
 * Equipamentos list filters that arrive in the URL (dashboard drill-through):
 * `?tab=devices&status=ACTIVE,MAINTENANCE&critical=true&lifecycle=overdue|due:N&lifecycleKind=SUPPORT`.
 * They are passed as-is to GET /devices, which validates them (400 with a message).
 */
import { hasTableFilters, parseTableState, serializeTableState, type TableStateConfig } from '@/components/data-table';

export type DeviceUrlFilters = { status: string; critical: string; lifecycle: string; lifecycleKind: string };
export const emptyDeviceUrlFilters: DeviceUrlFilters = { status: '', critical: '', lifecycle: '', lifecycleKind: '' };
/** Search stays in the page's own box (`search` key unused in the URL), so only the filters are read here. */
export const deviceUrlConfig: TableStateConfig<DeviceUrlFilters> = { filters: emptyDeviceUrlFilters, sortable: [], searchKey: 'deviceSearch' };

export const readDeviceUrlFilters = (query: string): DeviceUrlFilters => parseTableState(query, deviceUrlConfig).filters;
export const hasDeviceUrlFilters = (filters: DeviceUrlFilters) => hasTableFilters({ search: '', filters }, emptyDeviceUrlFilters);
/** The query string without the device filters (other parameters are kept). */
export const clearDeviceUrlFilters = (query: string) => serializeTableState(query, { search: '', filters: emptyDeviceUrlFilters, sort: null }, deviceUrlConfig);

/** `&status=…&critical=…` for GET /devices; empty when there are no filters. */
export function deviceFilterQuery(filters: Partial<DeviceUrlFilters> = {}): string {
  return (Object.keys(emptyDeviceUrlFilters) as Array<keyof DeviceUrlFilters>)
    .filter((key) => filters[key])
    .map((key) => `&${key}=${encodeURIComponent(filters[key]!)}`)
    .join('');
}

const statusLabels: Record<string, string> = { ACTIVE: 'Ativo', INACTIVE: 'Inativo', MAINTENANCE: 'Em manutenção', RETIRED: 'Retirado', UNKNOWN: 'Desconhecido' };

/** Readable summary of the active filters, e.g. ["Estado: Ativo, Em manutenção", "Críticos"]. */
export function deviceFilterLabels(filters: DeviceUrlFilters): string[] {
  const labels: string[] = [];
  if (filters.status) labels.push(`Estado: ${filters.status.split(',').map((value) => statusLabels[value.trim().toUpperCase()] ?? value.trim()).join(', ')}`);
  if (filters.critical === 'true') labels.push('Críticos');
  else if (filters.critical === 'false') labels.push('Não críticos');
  else if (filters.critical) labels.push(`Crítico: ${filters.critical}`);
  const due = /^due:(\d+)$/.exec(filters.lifecycle);
  if (filters.lifecycle === 'overdue') labels.push('Ciclo de vida expirado');
  else if (due) labels.push(`Ciclo de vida nos próximos ${due[1]} dias`);
  else if (filters.lifecycle) labels.push(`Ciclo de vida: ${filters.lifecycle}`);
  if (filters.lifecycleKind) labels.push(`Tipo de data: ${filters.lifecycleKind}`);
  return labels;
}
