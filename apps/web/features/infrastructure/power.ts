import type { ApiPowerValueSource, Device, DeviceModel, PduConnection, PduOutlet, PowerFeedSource, Rack, RackPdu, WattsSource } from './types';

/** Artwork for a vertical PDU strip (32-outlet reference picture, cropped). Width / height of the picture. */
export const PDU_IMAGE = '/assets/pdu-vertical-32.webp';
export const PDU_IMAGE_ASPECT = 95 / 1680;

/**
 * Power defaults from `GET /api/v1/power/defaults`. The API's `power-defaults.ts` is the only place they are defined:
 * the UI never hardcodes them. While they load (`null`), forms show no placeholder and badges have no amber tier.
 */
export interface PowerDefaults {
  pduOutletCount: number;
  pduBudgetWatts: number;
  maxPduOutletCount: number;
  powerPlugCount: number;
  minPowerPlugCount: number;
  maxPowerPlugCount: number;
  maxWatts: number;
  wattsByDeviceType: Record<string, number>;
  wattsFallback: number;
  warningRatio: number;
  criticalRatio: number;
}

export const FEED_ORDER: PowerFeedSource[] = ['SUPPLIER', 'UPS'];

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The API names value sources in Portuguese ("modelo", "padrão"); the UI keys use manual / model / default. */
export function wattsSourceFromApi(source: ApiPowerValueSource | string | null | undefined): WattsSource {
  if (source === 'manual') return 'manual';
  if (source === 'modelo' || source === 'model') return 'model';
  return 'default';
}

/** Plug count of a model when it has one, else the default. */
export function inheritedPlugCount(model?: Pick<DeviceModel, 'powerPlugCount'> | null, defaults?: PowerDefaults | null): number | null {
  if (finite(model?.powerPlugCount)) return model.powerPlugCount;
  return defaults?.powerPlugCount ?? null;
}

/** Power plugs of a device: the API's value, its own, the model's, then the default (null while defaults load). */
export function devicePlugCount(device: Pick<Device, 'powerPlugCount' | 'power' | 'model'>, defaults?: PowerDefaults | null): number | null {
  if (finite(device.power?.plugCount)) return device.power.plugCount;
  if (finite(device.powerPlugCount)) return device.powerPlugCount;
  return inheritedPlugCount(device.model, defaults);
}

/** Watts a device gets when it has no value of its own: the model's typical watts, else the type default. */
export function inheritedWatts(type: string | undefined, model?: Pick<DeviceModel, 'typicalWatts'> | null, defaults?: PowerDefaults | null): { watts: number | null; source: Exclude<WattsSource, 'manual'> } {
  if (finite(model?.typicalWatts)) return { watts: model.typicalWatts, source: 'model' };
  if (!defaults) return { watts: null, source: 'default' };
  return { watts: defaults.wattsByDeviceType[String(type ?? '').toUpperCase()] ?? defaults.wattsFallback, source: 'default' };
}

/** Estimated watts of a device and where they come from: manual → model → type default. */
export function deviceWatts(device: Pick<Device, 'type' | 'estimatedWatts' | 'power' | 'model'>, defaults?: PowerDefaults | null): { watts: number; source: WattsSource } {
  if (finite(device.power?.estimatedWatts)) return { watts: device.power.estimatedWatts, source: wattsSourceFromApi(device.power.wattsSource) };
  if (finite(device.estimatedWatts)) return { watts: device.estimatedWatts, source: 'manual' };
  const inherited = inheritedWatts(String(device.type), device.model, defaults);
  return { watts: inherited.watts ?? 0, source: inherited.source };
}

/** Outlets of a connection as {outletIndex, plugIndex}; bare numbers get plug numbers in order. */
export function connectionOutlets(connection: Pick<PduConnection, 'outlets'>): PduOutlet[] {
  return (connection.outlets ?? []).map((outlet, index) => (typeof outlet === 'number' ? { outletIndex: outlet, plugIndex: index + 1 } : outlet));
}

export function pduUsedOutlets(pdu: RackPdu): number {
  if (finite(pdu.usedOutlets)) return pdu.usedOutlets;
  return (pdu.connections ?? []).reduce((total, connection) => total + connectionOutlets(connection).length, 0);
}

/** Every device's outlet count per PDU on this rack, keyed by device id. */
function plugsByDevice(pdus: RackPdu[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const pdu of pdus) {
    for (const connection of pdu.connections ?? []) {
      const perPdu = map.get(connection.deviceId) ?? new Map<string, number>();
      perPdu.set(pdu.id, (perPdu.get(pdu.id) ?? 0) + connectionOutlets(connection).length);
      map.set(connection.deviceId, perPdu);
    }
  }
  return map;
}

/** A device's whole estimated load: the API's value when present, else computed from the rack's device list. */
function connectionFullWatts(connection: PduConnection, devices: Device[], defaults?: PowerDefaults | null): number {
  if (finite(connection.deviceEstimatedWatts)) return connection.deviceEstimatedWatts;
  const device = devices.find((item) => item.id === connection.deviceId);
  return device ? deviceWatts(device, defaults).watts : 0;
}

export interface PduConnectionView {
  deviceId: string;
  deviceName: string;
  outlets: PduOutlet[];
  /** Load on this PDU in normal operation. */
  watts: number;
  /** The device's whole load. */
  fullWatts: number;
  /** True when the device also has plugs on another PDU of this rack. */
  dualFed: boolean;
}

export interface PduView {
  pdu: RackPdu;
  name: string;
  used: number;
  total: number;
  watts: number;
  budget: number | null;
  /** Load if the other feed fails; null when no device on this PDU is dual-fed. */
  failoverWatts: number | null;
  level: PowerLevel;
  connections: PduConnectionView[];
}

export type PowerLevel = 'ok' | 'warn' | 'over';

/**
 * Amber at the defaults' warning ratio of outlets or budget (normal or failover), red when every outlet is used or the
 * budget is exceeded. Without defaults (still loading) there is no amber tier.
 */
export function powerLevel({ used, total, watts, budget, failoverWatts, warningRatio }: { used: number; total: number; watts: number; budget: number | null; failoverWatts?: number | null; warningRatio?: number | null }): PowerLevel {
  const outletRatio = total > 0 ? used / total : 0;
  const wattRatios = budget && budget > 0 ? [watts / budget, (failoverWatts ?? 0) / budget] : [0];
  const wattRatio = Math.max(...wattRatios);
  if (outletRatio >= 1 || wattRatio > 1) return 'over';
  if (finite(warningRatio) && (outletRatio >= warningRatio || wattRatio >= warningRatio)) return 'warn';
  return 'ok';
}

const LEVEL_RANK: Record<PowerLevel, number> = { ok: 0, warn: 1, over: 2 };
const FROM_API: Record<string, PowerLevel> = { ok: 'ok', warning: 'warn', critical: 'over' };

/** Maps an API load level (ok / warning / critical) to the UI's power level; unknown values are ok. */
export function powerLevelFromApi(level: string | null | undefined): PowerLevel {
  return (level && FROM_API[level]) || 'ok';
}

/** The API's own levels (computed with its thresholds), worst of outlets / watts / failover; null when absent. */
function apiLevel(pdu: RackPdu): PowerLevel | null {
  if (!pdu.levels) return null;
  return Object.values(pdu.levels).map((level) => FROM_API[level] ?? 'ok').reduce((worst, level) => (LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst), 'ok' as PowerLevel);
}

/** Default name of a PDU without one. */
export function defaultPduName(source: PowerFeedSource): string {
  return source === 'UPS' ? 'PDU UPS' : 'PDU Rede';
}

/**
 * Everything the strip, its card and the header show for one PDU. API totals win; otherwise a dual-fed device's load is
 * split by its connected plugs, and the failover figure moves each dual-fed device's whole load onto this PDU.
 */
export function pduView(pdu: RackPdu, rack: Pick<Rack, 'pdus' | 'devices'>, defaults?: PowerDefaults | null): PduView {
  const pdus = rack.pdus ?? [pdu];
  const devices = rack.devices ?? [];
  const byDevice = plugsByDevice(pdus);
  const connections = (pdu.connections ?? []).map((connection): PduConnectionView => {
    const outlets = connectionOutlets(connection);
    const perPdu = byDevice.get(connection.deviceId) ?? new Map<string, number>();
    const connectedPlugs = [...perPdu.values()].reduce((total, count) => total + count, 0) || outlets.length || 1;
    const fullWatts = connectionFullWatts(connection, devices, defaults);
    const watts = finite(connection.estimatedWattsShare) ? connection.estimatedWattsShare : fullWatts * outlets.length / connectedPlugs;
    return { deviceId: connection.deviceId, deviceName: connection.deviceName, outlets, watts, fullWatts, dualFed: perPdu.size > 1 };
  });
  const watts = finite(pdu.estimatedWatts) ? pdu.estimatedWatts : connections.reduce((total, item) => total + item.watts, 0);
  const anyDualFed = connections.some((item) => item.dualFed);
  const failoverWatts = !anyDualFed ? null : finite(pdu.failoverWatts) ? pdu.failoverWatts : connections.reduce((total, item) => total + (item.dualFed ? item.fullWatts : item.watts), 0);
  const used = pduUsedOutlets(pdu);
  const budget = finite(pdu.budgetWatts) ? pdu.budgetWatts : null;
  return {
    pdu,
    name: pdu.name?.trim() || defaultPduName(pdu.source),
    used,
    total: pdu.outletCount,
    watts,
    budget,
    failoverWatts,
    level: apiLevel(pdu) ?? powerLevel({ used, total: pdu.outletCount, watts, budget, failoverWatts, warningRatio: defaults?.warningRatio }),
    connections,
  };
}

/** The rack's PDUs in display order: supplier first, then UPS. */
export function sortedPdus(rack: Pick<Rack, 'pdus'>): RackPdu[] {
  return [...(rack.pdus ?? [])].sort((a, b) => FEED_ORDER.indexOf(a.source) - FEED_ORDER.indexOf(b.source));
}

export function rackHasUps(rack: Pick<Rack, 'pdus'>): boolean {
  return (rack.pdus ?? []).some((pdu) => pdu.source === 'UPS');
}

/** Rack total and per-feed totals for the header. */
export function rackPowerTotals(rack: Pick<Rack, 'pdus' | 'devices' | 'power'>): { total: number; bySource: Partial<Record<PowerFeedSource, number>> } {
  const totals = rack.power?.totals;
  if (totals && finite(totals.estimatedWatts)) {
    // Only feeds that have a PDU on this rack (the API also sends a 0 for a missing UPS).
    const present = new Set((rack.pdus ?? []).map((pdu) => pdu.source));
    const bySource = Object.fromEntries(Object.entries(totals.bySource ?? {}).filter(([source]) => present.has(source as PowerFeedSource))) as Partial<Record<PowerFeedSource, number>>;
    return { total: totals.estimatedWatts, bySource };
  }
  const bySource: Partial<Record<PowerFeedSource, number>> = {};
  for (const pdu of rack.pdus ?? []) bySource[pdu.source] = (bySource[pdu.source] ?? 0) + pduView(pdu, rack).watts;
  return { total: Object.values(bySource).reduce((sum, value) => sum + (value ?? 0), 0), bySource };
}

/**
 * Estimated watts for display: always "~", rounded to 10 W, in kW from 1,000 W. Decimal separator follows the locale.
 */
export function formatWatts(watts: number, locale = 'pt-PT'): string {
  const rounded = Math.round(Math.max(0, watts) / 10) * 10;
  if (rounded >= 1000) return `~${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rounded / 1000)} kW`;
  return `~${new Intl.NumberFormat(locale).format(rounded)} W`;
}

/** Budget for display, without "~" (it is a setting, not an estimate). */
export function formatBudget(watts: number, locale = 'pt-PT'): string {
  if (watts >= 1000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(watts / 1000)} kW`;
  return `${new Intl.NumberFormat(locale).format(watts)} W`;
}

// ── Power step: plug → PDU/outlet rows ─────────────────────────────────────

export interface PlugRow { plugIndex: number; pduId: string; outletIndex: number | null }

/** Outlets used on a PDU by devices other than `deviceId`. */
export function takenOutlets(pdu: RackPdu, deviceId?: string): Set<number> {
  const taken = new Set<number>();
  for (const connection of pdu.connections ?? []) {
    if (connection.deviceId === deviceId) continue;
    for (const outlet of connectionOutlets(connection)) taken.add(outlet.outletIndex);
  }
  return taken;
}

/** Lowest free outlet on the PDU, skipping `reserved` (picked by other rows). Null when the PDU is full. */
export function nextFreeOutlet(pdu: RackPdu, deviceId: string | undefined, reserved: Iterable<number> = []): number | null {
  const taken = takenOutlets(pdu, deviceId);
  for (const outlet of reserved) taken.add(outlet);
  for (let outlet = 1; outlet <= pdu.outletCount; outlet += 1) if (!taken.has(outlet)) return outlet;
  return null;
}

/**
 * Default plug rows: on a supplier-only rack every plug goes on the supplier PDU; with a UPS PDU, plugs alternate
 * supplier / UPS starting with the supplier (the usual A/B feed), so 1 plug → supplier. Each row gets the next free
 * outlet; plugs that do not fit stay unplugged (pduId '').
 */
export function defaultPlugRows(plugs: number, pdus: RackPdu[], deviceId?: string): PlugRow[] {
  const supplier = pdus.find((pdu) => pdu.source === 'SUPPLIER');
  const ups = pdus.find((pdu) => pdu.source === 'UPS');
  const rows: PlugRow[] = [];
  for (let plugIndex = 1; plugIndex <= plugs; plugIndex += 1) {
    const pdu = ups && plugIndex % 2 === 0 ? ups : supplier ?? ups;
    rows.push({ plugIndex, pduId: pdu?.id ?? '', outletIndex: null });
  }
  return assignOutlets(rows, pdus, deviceId);
}

/** Rows for a device already connected on this rack, with any plugs not connected left unplugged. */
export function existingPlugRows(plugs: number, pdus: RackPdu[], deviceId: string): PlugRow[] {
  const byPlug = new Map<number, { pduId: string; outletIndex: number }>();
  for (const pdu of pdus) for (const connection of pdu.connections ?? []) {
    if (connection.deviceId !== deviceId) continue;
    for (const outlet of connectionOutlets(connection)) byPlug.set(outlet.plugIndex, { pduId: pdu.id, outletIndex: outlet.outletIndex });
  }
  return Array.from({ length: plugs }, (_, index) => {
    const found = byPlug.get(index + 1);
    return { plugIndex: index + 1, pduId: found?.pduId ?? '', outletIndex: found?.outletIndex ?? null };
  });
}

export function deviceIsConnected(pdus: RackPdu[], deviceId: string): boolean {
  return pdus.some((pdu) => (pdu.connections ?? []).some((connection) => connection.deviceId === deviceId && connectionOutlets(connection).length > 0));
}

/** Fills missing outlets (or outlets clashing with another row) with the next free one; full PDUs leave the plug unplugged. */
export function assignOutlets(rows: PlugRow[], pdus: RackPdu[], deviceId?: string): PlugRow[] {
  const reserved = new Map<string, Set<number>>();
  const reserve = (pduId: string) => reserved.get(pduId) ?? reserved.set(pduId, new Set()).get(pduId)!;
  // Keep valid explicit choices first so auto-picks never steal them.
  const kept = rows.map((row) => {
    const pdu = pdus.find((item) => item.id === row.pduId);
    if (!pdu || row.outletIndex == null) return false;
    const mine = reserve(pdu.id);
    const valid = row.outletIndex >= 1 && row.outletIndex <= pdu.outletCount && !takenOutlets(pdu, deviceId).has(row.outletIndex) && !mine.has(row.outletIndex);
    if (valid) mine.add(row.outletIndex);
    return valid;
  });
  return rows.map((row, index) => {
    if (kept[index]) return row;
    const pdu = pdus.find((item) => item.id === row.pduId);
    if (!pdu) return { ...row, pduId: '', outletIndex: null };
    const outlet = nextFreeOutlet(pdu, deviceId, reserve(pdu.id));
    if (outlet == null) return { ...row, pduId: '', outletIndex: null };
    reserve(pdu.id).add(outlet);
    return { ...row, outletIndex: outlet };
  });
}

// ── Optimistic Desligar ────────────────────────────────────────────────────

/** The rack with `deviceId` removed from one PDU, totals adjusted, so the badge drops before the API answers. */
export function withoutPduConnection<T extends Pick<Rack, 'pdus' | 'devices'>>(rack: T, pduId: string, deviceId: string): T {
  if (!rack.pdus?.some((pdu) => pdu.id === pduId)) return rack;
  return {
    ...rack,
    // Rack totals are recomputed from the PDUs until the API answers with fresh ones.
    ...('power' in rack ? { power: null } : {}),
    pdus: rack.pdus.map((pdu) => {
      // On the other feed the device is no longer dual-fed: drop the stale failover figure there too.
      if (pdu.id !== pduId) return (pdu.connections ?? []).some((connection) => connection.deviceId === deviceId) ? { ...pdu, failoverWatts: undefined, levels: undefined } : pdu;
      const removed = (pdu.connections ?? []).filter((connection) => connection.deviceId === deviceId);
      if (!removed.length) return pdu;
      const view = pduView(pdu, rack);
      const removedWatts = view.connections.filter((item) => item.deviceId === deviceId).reduce((total, item) => total + item.watts, 0);
      const removedOutlets = removed.reduce((total, connection) => total + connectionOutlets(connection).length, 0);
      return {
        ...pdu,
        connections: (pdu.connections ?? []).filter((connection) => connection.deviceId !== deviceId),
        usedOutlets: finite(pdu.usedOutlets) ? Math.max(0, pdu.usedOutlets - removedOutlets) : undefined,
        freeOutlets: finite(pdu.freeOutlets) ? pdu.freeOutlets + removedOutlets : undefined,
        estimatedWatts: finite(pdu.estimatedWatts) ? Math.max(0, pdu.estimatedWatts - removedWatts) : undefined,
        // The failover figure depends on the other PDU too: let the client recompute it until the API answers.
        failoverWatts: undefined,
        // The API's levels are stale too: the badge falls back to the local rule until the API answers.
        levels: undefined,
      };
    }),
  };
}
