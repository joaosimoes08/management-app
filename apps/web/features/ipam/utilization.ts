import { formatNumber } from '@/lib/format/date';
import type { Subnet, SubnetUtilization } from './types';
import { ipamText } from './i18n';

/** Thresholds the API uses for `utilization.band` (shown in tooltips; the band itself comes from the API). */
export const UTILIZATION_WARNING_PERCENT = 80;
export const UTILIZATION_CRITICAL_PERCENT = 90;

const UTILIZATION_BANDS = ['OK', 'WARNING', 'CRITICAL', 'UNTRACKED'] as const;

/** Filter chips per utilisation band, in the active language. */
export function utilizationBandOptions(): ReadonlyArray<readonly [string, string]> {
  return UTILIZATION_BANDS.map((band) => [band, ipamText(`ipam.utilization.filter.${band}`)] as const);
}

const LABELLED_BANDS = ['WARNING', 'CRITICAL'];
const bandTone: Record<string, string> = { OK: 'occupied', WARNING: 'reserved', CRITICAL: 'excluded' };

export function formatIpamPercent(value: number): string {
  return `${formatNumber(value, { maximumFractionDigits: 2 })}%`;
}

export type UtilizationBadge = { tone: string; label: string; title: string };

/** Badge for a subnet utilisation. Unknown bands render as a neutral badge with the raw band. */
export function utilizationBadge(utilization: SubnetUtilization | null | undefined): UtilizationBadge | null {
  if (!utilization) return null;
  const { band, utilizationPercent } = utilization;
  if (band === 'UNTRACKED' || utilizationPercent === null || utilizationPercent === undefined) {
    return { tone: '', label: band === 'UNTRACKED' ? ipamText('ipam.utilization.untracked') : String(band || '—'), title: ipamText('ipam.utilization.untrackedTitle') };
  }
  const percent = formatIpamPercent(utilizationPercent);
  const bandLabel = band === 'OK' ? '' : LABELLED_BANDS.includes(band) ? ipamText(`ipam.utilization.band.${band}`) : String(band);
  const suffix = bandLabel ? ` · ${bandLabel}` : '';
  const counts = [
    typeof utilization.allocated === 'number' && typeof utilization.usableCapacity === 'number' ? ipamText('ipam.utilization.allocated', { allocated: utilization.allocated, capacity: utilization.usableCapacity }) : '',
    typeof utilization.free === 'number' ? ipamText('ipam.utilization.free', { free: utilization.free }) : '',
  ].filter(Boolean).join(' · ');
  return { tone: bandTone[band] ?? '', label: `${percent}${suffix}`, title: counts };
}

/** Sort value: IPv6/unknown utilisation is empty, so it always sorts last. */
export const utilizationSortValue = (subnet: Subnet) => subnet.utilization?.utilizationPercent ?? null;
