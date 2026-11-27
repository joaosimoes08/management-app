import { ipamText } from './i18n';
import type { AssetStatus } from '@/features/infrastructure/types';
import type { ServiceStatus } from './types';

/** Host/device statuses in the order the pickers list them. */
export const ASSET_STATUSES: readonly AssetStatus[] = ['UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'];
/** Service statuses accepted by Create/UpdateServiceDto, in picker order. */
export const SERVICE_STATUSES: readonly ServiceStatus[] = ['UNKNOWN', 'OPEN', 'CLOSED', 'DEGRADED', 'DISABLED'];

export function isAssetStatus(value: string): value is AssetStatus {
  return (ASSET_STATUSES as readonly string[]).includes(value);
}

export function isServiceStatus(value: string): value is ServiceStatus {
  return (SERVICE_STATUSES as readonly string[]).includes(value);
}

const stateLabels = new Map([
  ['FREE', 'Livre'],
  ['OCCUPIED', 'Ocupado'],
  ['RESERVED', 'Reservado'],
  ['EXCLUDED', 'Excluído'],
  ['UNKNOWN', 'Desconhecido'],
  ['REACHABLE', 'Acessível'],
  ['UNREACHABLE', 'Inacessível'],
]);

export function ipStateLabel(state?: string | null): string {
  return state ? stateLabels.get(state) ?? 'Desconhecido' : '—';
}

const hostStatusLabels = new Map([
  ['UNKNOWN', 'Desconhecido'],
  ['ACTIVE', 'Ativo'],
  ['INACTIVE', 'Inativo'],
  ['MAINTENANCE', 'Manutenção'],
  ['RETIRED', 'Retirado'],
]);

/** Manual status of a Host (the value stored in the API; labels only for display). */
export function hostStatusLabel(status?: string | null): string {
  return status ? hostStatusLabels.get(status) ?? 'Desconhecido' : '—';
}

const observedStatusLabels = new Map([
  ...stateLabels,
  ['OPEN', 'Aberto'],
  ['ACTIVE', 'Ativo'],
]);

const OBSERVED_TEXT = ['CLOSED', 'DEGRADED', 'DISABLED'];

/** Observed or manual status of a Host service or observed Host status. */
export function observedStatusLabel(status?: string | null): string {
  if (status && OBSERVED_TEXT.includes(status)) return ipamText(`ipam.state.observed.${status}`);
  return status ? observedStatusLabels.get(status) ?? 'Desconhecido' : '—';
}

/** One entry per SourceType value in packages/database/prisma/schema.prisma. */
const sourceLabels = new Map([
  ['MANUAL', 'Manual'],
  ['SNMP', 'SNMP'],
  ['ICMP', 'ICMP'],
  ['TCP', 'TCP'],
  ['DNS', 'DNS'],
  ['DHCP', 'DHCP'],
]);

const SOURCE_TEXT = ['AGENT', 'IMPORT'];

/** Where a Host or service record came from. Unknown sources read as "Outra origem". */
export function sourceLabel(source?: string | null): string {
  if (!source) return '—';
  if (SOURCE_TEXT.includes(source)) return ipamText(`ipam.state.source.${source}`);
  return sourceLabels.get(source) ?? ipamText('ipam.state.source.other');
}
