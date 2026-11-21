/**
 * Rack power summary (GET racks/:id/power-summary, GET sites/:siteId/power-summary).
 * Pure functions on top of summarizeRackPower: capacity vs estimated draw, outlets and devices near the limit,
 * with caller-chosen warning/critical thresholds (defaults 80 % / 90 %). No database access here.
 */
import { BadRequestException } from '@nestjs/common';
import type { LoadLevel, PowerFeedSource, RackPowerMode, RackPowerSummary } from './rack-power';

export const SUMMARY_DEFAULT_WARNING_PERCENT = 80;
export const SUMMARY_DEFAULT_CRITICAL_PERCENT = 90;
export const SITE_SUMMARY_RACK_LIMIT = 1000;

export interface SummaryThresholds { warningPercent: number; criticalPercent: number }

/** Parses ?warningPercent=&criticalPercent= (1–200, warning < critical). Missing values use 80 / 90. */
export function parseThresholds(warning?: string, critical?: string): SummaryThresholds {
  const read = (raw: string | undefined, fallback: number, field: string) => {
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1 || value > 200) throw new BadRequestException({ code: 'POWER_THRESHOLD_INVALID', message: `${field} tem de ser um número entre 1 e 200.` });
    return value;
  };
  const warningPercent = read(warning, SUMMARY_DEFAULT_WARNING_PERCENT, 'warningPercent');
  const criticalPercent = read(critical, SUMMARY_DEFAULT_CRITICAL_PERCENT, 'criticalPercent');
  if (warningPercent >= criticalPercent) throw new BadRequestException({ code: 'POWER_THRESHOLD_INVALID', message: 'warningPercent tem de ser menor do que criticalPercent.' });
  return { warningPercent, criticalPercent };
}

const percent = (value: number, total: number | null) => (total && total > 0 ? Math.round((value / total) * 1000) / 10 : null);
const LEVEL_RANK: Record<LoadLevel, number> = { ok: 0, warning: 1, critical: 2 };
export const worstLevel = (levels: LoadLevel[]): LoadLevel => levels.reduce<LoadLevel>((worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), 'ok');

/** Level of a utilisation percentage. null (no budget / no outlets) is ok. Zero capacity with load is critical. */
export function thresholdLevel(value: number, total: number | null, thresholds: SummaryThresholds): LoadLevel {
  if (total === null || total === undefined) return 'ok';
  if (total <= 0) return value > 0 ? 'critical' : 'ok';
  const ratio = (value / total) * 100;
  if (ratio >= thresholds.criticalPercent) return 'critical';
  if (ratio >= thresholds.warningPercent) return 'warning';
  return 'ok';
}

export interface RackSummaryInput {
  rack: { id: string; name: string; roomId: string; roomName?: string | null; buildingName?: string | null };
  devices: { id: string; name: string }[];
  power: RackPowerSummary;
}

export interface PduPowerSummary {
  id: string; name: string | null; source: PowerFeedSource;
  budgetWatts: number | null; estimatedWatts: number; failoverWatts: number;
  wattsPercent: number | null; failoverPercent: number | null;
  outlets: { used: number; total: number; free: number; percent: number | null };
  levels: { watts: LoadLevel; failoverWatts: LoadLevel; outlets: LoadLevel };
  level: LoadLevel;
}

export interface RackPowerSummaryView {
  rack: RackSummaryInput['rack'];
  mode: RackPowerMode;
  thresholds: SummaryThresholds;
  level: LoadLevel;
  capacity: { watts: number | null; bySource: Record<PowerFeedSource, number | null>; missingBudgetPduIds: string[] };
  draw: { estimatedWatts: number; bySource: Record<PowerFeedSource, number>; worstFailoverWatts: number };
  utilisation: { bySource: Record<PowerFeedSource, number | null>; worstFailoverPercent: number | null };
  outlets: { used: number; total: number; free: number; percent: number | null; level: LoadLevel };
  pdus: PduPowerSummary[];
  nearLimit: {
    pdus: { id: string; name: string | null; source: PowerFeedSource; level: LoadLevel; reasons: ('watts' | 'failoverWatts' | 'outlets')[] }[];
    /** Devices drawing from at least one PDU at warning or critical (watts or failover), heaviest first. */
    devices: { id: string; name: string; estimatedWatts: number; pduIds: string[]; level: LoadLevel }[];
  };
  devices: {
    total: number;
    connected: number;
    unconnected: { id: string; name: string }[];
    partiallyConnected: { id: string; name: string; connectedPlugs: number; plugCount: number }[];
    /** Only in SUPPLIER_AND_UPS racks: connected devices whose plugs do not reach both feeds. */
    nonRedundant: { id: string; name: string }[];
  };
}

export function buildRackPowerSummary(input: RackSummaryInput, thresholds: SummaryThresholds): RackPowerSummaryView {
  const { power } = input;
  const names = new Map(input.devices.map((device) => [device.id, device.name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  const pdus: PduPowerSummary[] = power.pdus.map((pdu) => {
    const levels = {
      watts: thresholdLevel(pdu.estimatedWatts, pdu.budgetWatts, thresholds),
      failoverWatts: thresholdLevel(pdu.failoverWatts, pdu.budgetWatts, thresholds),
      outlets: thresholdLevel(pdu.usedOutlets, pdu.outletCount, thresholds),
    };
    return {
      id: pdu.id, name: pdu.name, source: pdu.source, budgetWatts: pdu.budgetWatts,
      estimatedWatts: pdu.estimatedWatts, failoverWatts: pdu.failoverWatts,
      wattsPercent: percent(pdu.estimatedWatts, pdu.budgetWatts), failoverPercent: percent(pdu.failoverWatts, pdu.budgetWatts),
      outlets: { used: pdu.usedOutlets, total: pdu.outletCount, free: pdu.freeOutlets, percent: percent(pdu.usedOutlets, pdu.outletCount) },
      levels, level: worstLevel([levels.watts, levels.failoverWatts, levels.outlets]),
    };
  });

  const missingBudgetPduIds = pdus.filter((pdu) => pdu.budgetWatts === null).map((pdu) => pdu.id);
  const capacityFor = (source: PowerFeedSource) => {
    const list = pdus.filter((pdu) => pdu.source === source);
    if (!list.length || list.some((pdu) => pdu.budgetWatts === null)) return null;
    return list.reduce((sum, pdu) => sum + (pdu.budgetWatts as number), 0);
  };
  const capacityBySource = { SUPPLIER: capacityFor('SUPPLIER'), UPS: capacityFor('UPS') };
  const capacityWatts = pdus.length && !missingBudgetPduIds.length ? pdus.reduce((sum, pdu) => sum + (pdu.budgetWatts as number), 0) : null;
  const worstFailover = pdus.reduce<PduPowerSummary | null>((worst, pdu) => (!worst || (pdu.failoverPercent ?? -1) > (worst.failoverPercent ?? -1) ? pdu : worst), null);

  const usedOutlets = pdus.reduce((sum, pdu) => sum + pdu.outlets.used, 0);
  const totalOutlets = pdus.reduce((sum, pdu) => sum + pdu.outlets.total, 0);
  const outletLevel = thresholdLevel(usedOutlets, totalOutlets, thresholds);

  const nearPdus = pdus.filter((pdu) => pdu.level !== 'ok').map((pdu) => ({
    id: pdu.id, name: pdu.name, source: pdu.source, level: pdu.level,
    reasons: (['watts', 'failoverWatts', 'outlets'] as const).filter((key) => pdu.levels[key] !== 'ok'),
  }));
  const loadLevelByPdu = new Map(pdus.map((pdu) => [pdu.id, worstLevel([pdu.levels.watts, pdu.levels.failoverWatts])]));
  const nearDevices = power.devices
    .map((device) => {
      const pduIds = [...new Set(device.assignments.map((item) => item.pduId))].filter((id) => loadLevelByPdu.get(id) !== 'ok');
      return { id: device.deviceId, name: nameOf(device.deviceId), estimatedWatts: device.estimatedWatts, pduIds, level: worstLevel(pduIds.map((id) => loadLevelByPdu.get(id) ?? 'ok')) };
    })
    .filter((device) => device.pduIds.length)
    .sort((a, b) => b.estimatedWatts - a.estimatedWatts || a.name.localeCompare(b.name));

  const needsPower = power.devices.filter((device) => device.plugCount > 0);
  return {
    rack: input.rack,
    mode: power.mode,
    thresholds,
    level: worstLevel(pdus.map((pdu) => pdu.level)),
    capacity: { watts: capacityWatts, bySource: capacityBySource, missingBudgetPduIds },
    draw: { estimatedWatts: power.totals.estimatedWatts, bySource: power.totals.bySource, worstFailoverWatts: worstFailover?.failoverWatts ?? 0 },
    utilisation: {
      bySource: { SUPPLIER: percent(power.totals.bySource.SUPPLIER, capacityBySource.SUPPLIER), UPS: percent(power.totals.bySource.UPS, capacityBySource.UPS) },
      worstFailoverPercent: worstFailover?.failoverPercent ?? null,
    },
    outlets: { used: usedOutlets, total: totalOutlets, free: Math.max(0, totalOutlets - usedOutlets), percent: percent(usedOutlets, totalOutlets), level: outletLevel },
    pdus,
    nearLimit: { pdus: nearPdus, devices: nearDevices },
    devices: {
      total: power.devices.length,
      connected: power.devices.filter((device) => device.connectedPlugs > 0).length,
      unconnected: power.totals.unconnectedDeviceIds.map((id) => ({ id, name: nameOf(id) })),
      partiallyConnected: needsPower.filter((device) => device.connectedPlugs > 0 && device.connectedPlugs < device.plugCount).map((device) => ({ id: device.deviceId, name: nameOf(device.deviceId), connectedPlugs: device.connectedPlugs, plugCount: device.plugCount })),
      nonRedundant: power.mode === 'SUPPLIER_AND_UPS' ? needsPower.filter((device) => device.connectedPlugs > 0 && !device.redundant).map((device) => ({ id: device.deviceId, name: nameOf(device.deviceId) })) : [],
    },
  };
}

/** Site roll-up: racks worst first, then by highest PDU utilisation. */
export function buildSitePowerSummary(siteId: string, racks: RackPowerSummaryView[], thresholds: SummaryThresholds, truncated: boolean) {
  const peak = (rack: RackPowerSummaryView) => Math.max(-1, ...rack.pdus.map((pdu) => Math.max(pdu.wattsPercent ?? -1, pdu.failoverPercent ?? -1, pdu.outlets.percent ?? -1)));
  const sorted = [...racks].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || peak(b) - peak(a) || a.rack.name.localeCompare(b.rack.name));
  const byLevel: Record<LoadLevel, number> = { ok: 0, warning: 0, critical: 0 };
  for (const rack of racks) byLevel[rack.level] += 1;
  const known = racks.filter((rack) => rack.capacity.watts !== null);
  return {
    siteId,
    thresholds,
    truncated,
    totals: {
      racks: racks.length,
      byLevel,
      capacityWatts: known.reduce((sum, rack) => sum + (rack.capacity.watts as number), 0),
      racksWithoutFullCapacity: racks.length - known.length,
      estimatedWatts: racks.reduce((sum, rack) => sum + rack.draw.estimatedWatts, 0),
      outlets: { used: racks.reduce((sum, rack) => sum + rack.outlets.used, 0), total: racks.reduce((sum, rack) => sum + rack.outlets.total, 0) },
      pdusNearLimit: racks.reduce((sum, rack) => sum + rack.nearLimit.pdus.length, 0),
      unconnectedDevices: racks.reduce((sum, rack) => sum + rack.devices.unconnected.length, 0),
      nonRedundantDevices: racks.reduce((sum, rack) => sum + rack.devices.nonRedundant.length, 0),
    },
    racks: sorted,
  };
}
