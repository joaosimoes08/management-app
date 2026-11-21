import type { Subnet, SubnetUtilization } from './types';

/** Thresholds the API uses for `utilization.band` (shown in tooltips; the band itself comes from the API). */
export const UTILIZATION_WARNING_PERCENT = 80;
export const UTILIZATION_CRITICAL_PERCENT = 90;

export const utilizationBandOptions = [
  ['OK', 'Normal'],
  ['WARNING', 'Atenção (≥ 80%)'],
  ['CRITICAL', 'Crítica (≥ 90%)'],
  ['UNTRACKED', 'Não contabilizada (IPv6)'],
] as const;

const bandLabels: Record<string, string> = { WARNING: 'Atenção', CRITICAL: 'Crítica' };
const bandTone: Record<string, string> = { OK: 'occupied', WARNING: 'reserved', CRITICAL: 'excluded' };

export type UtilizationBadge = { tone: string; label: string; title: string };

/** Badge for a subnet utilisation. Unknown bands render as a neutral badge with the raw band. */
export function utilizationBadge(utilization: SubnetUtilization | null | undefined): UtilizationBadge | null {
  if (!utilization) return null;
  const { band, utilizationPercent } = utilization;
  if (band === 'UNTRACKED' || utilizationPercent === null || utilizationPercent === undefined) {
    return { tone: '', label: band === 'UNTRACKED' ? 'Não contabilizada' : String(band || '—'), title: 'A capacidade de prefixos IPv6 não é enumerada.' };
  }
  const percent = `${Math.round(utilizationPercent * 10) / 10}%`;
  const bandLabel = band === 'OK' ? '' : bandLabels[band] ?? String(band);
  const suffix = bandLabel ? ` · ${bandLabel}` : '';
  const counts = [
    typeof utilization.allocated === 'number' && typeof utilization.usableCapacity === 'number' ? `${utilization.allocated} de ${utilization.usableCapacity} alocados` : '',
    typeof utilization.free === 'number' ? `${utilization.free} livres` : '',
  ].filter(Boolean).join(' · ');
  return { tone: bandTone[band] ?? '', label: `${percent}${suffix}`, title: counts };
}

/** Sort value: IPv6/unknown utilisation is empty, so it always sorts last. */
export const utilizationSortValue = (subnet: Subnet) => subnet.utilization?.utilizationPercent ?? null;
