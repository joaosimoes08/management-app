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

const IP_STATES = ['FREE', 'OCCUPIED', 'RESERVED', 'EXCLUDED', 'UNKNOWN', 'REACHABLE', 'UNREACHABLE'];
const ipStateText = (state: string) => ipamText(`ipam.state.ip.${IP_STATES.includes(state) ? state : 'UNKNOWN'}`);

export function ipStateLabel(state?: string | null): string {
  return state ? ipStateText(state) : '—';
}

/** Manual status of a Host (the value stored in the API; labels only for display). */
export function hostStatusLabel(status?: string | null): string {
  return status ? ipamText(`ipam.state.host.${isAssetStatus(status) ? status : 'UNKNOWN'}`) : '—';
}

const OBSERVED_TEXT = ['CLOSED', 'DEGRADED', 'DISABLED'];

/** Observed or manual status of a Host service or observed Host status. */
export function observedStatusLabel(status?: string | null): string {
  if (status && OBSERVED_TEXT.includes(status)) return ipamText(`ipam.state.observed.${status}`);
  if (status === 'OPEN') return ipamText('ipam.state.open');
  if (status === 'ACTIVE') return ipamText('ipam.state.host.ACTIVE');
  return status ? ipStateText(status) : '—';
}

/** One entry per SourceType value in packages/database/prisma/schema.prisma. */
const sourceLabels = new Map([
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
  if (source === 'MANUAL') return ipamText('ipam.state.sourceManual');
  return sourceLabels.get(source) ?? ipamText('ipam.state.source.other');
}
