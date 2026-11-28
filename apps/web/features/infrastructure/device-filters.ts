/**
 * Equipamentos list filters that arrive in the URL (dashboard drill-through):
 * `?tab=devices&status=ACTIVE,MAINTENANCE&critical=true&lifecycle=overdue|due:N&lifecycleKind=SUPPORT`.
 * They are passed as-is to GET /devices, which validates them (400 with a message).
 * Step 36: `tag=<id>[,<id>]` keeps devices that carry every listed tag; saved views store it too.
 * `type=SERVER` (or another EquipmentType) narrows the list by equipment type; `type=SERVER` replaces the old Servidores tab.
 */
import { portugueseText, type InfrastructureText } from './infrastructure-text';
import { hasTableFilters, parseTableState, serializeTableState, type TableStateConfig } from '@/components/data-table';

export type DeviceUrlFilters = { status: string; critical: string; lifecycle: string; lifecycleKind: string; tier: string; tag: string; type: string };
export const emptyDeviceUrlFilters: DeviceUrlFilters = { status: '', critical: '', lifecycle: '', lifecycleKind: '', tier: '', tag: '', type: '' };
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

/** Equipment types offered by the Equipamentos "Tipo" filter (values match EquipmentType); labels are message keys. */
const deviceTypeKeys: ReadonlyArray<readonly [string, string]> = [['SWITCH', 'infrastructure.deviceFilters.type.switches'], ['ROUTER', 'infrastructure.deviceFilters.type.routers'], ['FIREWALL', 'infrastructure.deviceFilters.type.firewalls'], ['SERVER', 'infrastructure.deviceFilters.type.servers'], ['STORAGE', 'infrastructure.deviceFilters.type.storage'], ['OTHER', 'infrastructure.deviceFilters.type.otherTypes']];
export const deviceTypeOptions = (ui: InfrastructureText = portugueseText): ReadonlyArray<readonly [string, string]> => deviceTypeKeys.map(([value, key]) => [value, ui(key)] as const);

const statusKeys: Record<string, string> = { ACTIVE: 'infrastructure.deviceFilters.status.active', INACTIVE: 'infrastructure.deviceFilters.status.inactive', MAINTENANCE: 'infrastructure.deviceFilters.status.maintenance', RETIRED: 'infrastructure.deviceFilters.status.retired', UNKNOWN: 'infrastructure.deviceFilters.status.unknown' };
const statusLabel = (value: string, ui: InfrastructureText) => { const key = statusKeys[value.trim().toUpperCase()]; return key ? ui(key) : value.trim(); };
/** Device states offered by the Equipamentos "Estado" chips (values match DeviceStatus). */
export const deviceStatusOptions = (ui: InfrastructureText = portugueseText): ReadonlyArray<readonly [string, string]> => Object.entries(statusKeys).map(([value, key]) => [value, ui(key)] as const);
/** Chip label for a status value, including comma lists from dashboard links ("Ativo, Em manutenção"). */
export const deviceStatusLabel = (value: string, ui: InfrastructureText = portugueseText) => value.split(',').map((part) => statusLabel(part, ui)).join(', ');

/** Readable summary of the active filters, e.g. ["Estado: Ativo, Em manutenção", "Críticos"]. */
export function deviceFilterLabels(filters: DeviceUrlFilters, tagName?: string, ui: InfrastructureText = portugueseText): string[] {
  const labels: string[] = [];
  if (filters.status) labels.push(ui('infrastructure.deviceFilters.label.status', undefined, { value: deviceStatusLabel(filters.status, ui) }));
  if (filters.critical === 'true') labels.push(ui('infrastructure.deviceFilters.label.critical'));
  else if (filters.critical === 'false') labels.push(ui('infrastructure.deviceFilters.label.notCritical'));
  else if (filters.critical) labels.push(ui('infrastructure.deviceFilters.label.criticalValue', undefined, { value: filters.critical }));
  const due = /^due:(\d+)$/.exec(filters.lifecycle);
  if (filters.lifecycle === 'overdue') labels.push(ui('infrastructure.deviceFilters.label.lifecycleExpired'));
  else if (due) labels.push(ui('infrastructure.deviceFilters.label.lifecycleDue', undefined, { days: due[1] }));
  else if (filters.lifecycle) labels.push(ui('infrastructure.deviceFilters.label.lifecycle', undefined, { value: filters.lifecycle }));
  if (filters.lifecycleKind) labels.push(ui('infrastructure.deviceFilters.label.dateType', undefined, { value: filters.lifecycleKind }));
  if (filters.tier) labels.push(ui('infrastructure.deviceFilters.label.tier', undefined, { value: filters.tier }));
  if (filters.tag) labels.push(ui('infrastructure.deviceFilters.label.tag', undefined, { value: tagName || filters.tag }));
  if (filters.type) labels.push(ui('infrastructure.deviceFilters.label.type', undefined, { value: deviceTypeOptions(ui).find(([value]) => value === filters.type)?.[1] ?? filters.type }));
  return labels;
}
