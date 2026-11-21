/**
 * Pure rack power logic: wattage resolution, outlet allocation, PDU settings planning and load summaries.
 * No database access here so every rule is unit-testable. Defaults come from ./power-defaults.ts.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  DEFAULT_PDU_BUDGET_WATTS,
  DEFAULT_PDU_OUTLET_COUNT,
  DEFAULT_POWER_PLUG_COUNT,
  DEFAULT_WATTS_BY_DEVICE_TYPE,
  DEFAULT_WATTS_FALLBACK,
  POWER_CRITICAL_RATIO,
  POWER_WARNING_RATIO,
} from './power-defaults';

export type PowerFeedSource = 'SUPPLIER' | 'UPS';
export type RackPowerMode = 'SUPPLIER_ONLY' | 'SUPPLIER_AND_UPS';
/** Where a device's watts (or plug count) came from. Shown as a chip in the UI. */
export type PowerValueSource = 'manual' | 'modelo' | 'padrão';
export type LoadLevel = 'ok' | 'warning' | 'critical';

export const POWER_FEED_SOURCES: readonly PowerFeedSource[] = ['SUPPLIER', 'UPS'];
export const RACK_POWER_MODES: readonly RackPowerMode[] = ['SUPPLIER_ONLY', 'SUPPLIER_AND_UPS'];

export interface PowerModelInput { powerPlugCount?: number | null; typicalWatts?: number | null; maxWatts?: number | null }
export interface PowerDeviceInput {
  id: string;
  name: string;
  type: string;
  powerPlugCount?: number | null;
  estimatedWatts?: number | null;
  model?: PowerModelInput | null;
}
export interface OutletAssignmentInput { pduId?: string; outletIndex: number; deviceId: string; plugIndex: number }
export interface PduInput {
  id: string;
  rackId: string;
  source: PowerFeedSource;
  name: string | null;
  outletCount: number;
  budgetWatts: number | null;
  outlets: OutletAssignmentInput[];
}

// ── Per-device values ───────────────────────────────────────────────────────

export function defaultWattsForType(type: string | null | undefined): number {
  const key = String(type ?? '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(DEFAULT_WATTS_BY_DEVICE_TYPE, key) ? DEFAULT_WATTS_BY_DEVICE_TYPE[key] : DEFAULT_WATTS_FALLBACK;
}

/** manual (Device.estimatedWatts) → modelo (DeviceModel.typicalWatts) → padrão (type default). */
export function resolveDeviceWatts(device: Pick<PowerDeviceInput, 'type' | 'estimatedWatts' | 'model'>): { watts: number; source: PowerValueSource } {
  if (device.estimatedWatts !== null && device.estimatedWatts !== undefined) return { watts: device.estimatedWatts, source: 'manual' };
  const modelWatts = device.model?.typicalWatts;
  if (modelWatts !== null && modelWatts !== undefined) return { watts: modelWatts, source: 'modelo' };
  return { watts: defaultWattsForType(device.type), source: 'padrão' };
}

/** manual (Device.powerPlugCount) → modelo (DeviceModel.powerPlugCount) → padrão (DEFAULT_POWER_PLUG_COUNT). */
export function resolvePlugCount(device: Pick<PowerDeviceInput, 'powerPlugCount' | 'model'>): { count: number; source: PowerValueSource } {
  if (device.powerPlugCount !== null && device.powerPlugCount !== undefined) return { count: device.powerPlugCount, source: 'manual' };
  const modelCount = device.model?.powerPlugCount;
  if (modelCount !== null && modelCount !== undefined) return { count: modelCount, source: 'modelo' };
  return { count: DEFAULT_POWER_PLUG_COUNT, source: 'padrão' };
}

export function rackPowerMode(pdus: Pick<PduInput, 'source'>[]): RackPowerMode {
  return pdus.some((pdu) => pdu.source === 'UPS') ? 'SUPPLIER_AND_UPS' : 'SUPPLIER_ONLY';
}

// ── Load levels ─────────────────────────────────────────────────────────────

/** Outlets: amber at >= 80 % used, red when every outlet is used. */
export function outletLoadLevel(used: number, total: number): LoadLevel {
  if (total <= 0) return used > 0 ? 'critical' : 'ok';
  const ratio = used / total;
  if (ratio >= POWER_CRITICAL_RATIO) return 'critical';
  if (ratio >= POWER_WARNING_RATIO) return 'warning';
  return 'ok';
}

/** Watts: amber at >= 80 % of budget, red above 100 %. No budget (null) is always ok. */
export function wattLoadLevel(watts: number, budget: number | null): LoadLevel {
  if (budget === null || budget === undefined) return 'ok';
  if (budget <= 0) return watts > 0 ? 'critical' : 'ok';
  const ratio = watts / budget;
  if (ratio > POWER_CRITICAL_RATIO) return 'critical';
  if (ratio >= POWER_WARNING_RATIO) return 'warning';
  return 'ok';
}

// ── Summaries (GET racks/:id) ───────────────────────────────────────────────

export interface PduConnectionSummary {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  /** Outlets this device uses on THIS PDU, sorted by outlet. */
  outlets: { outletIndex: number; plugIndex: number }[];
  /** Device's full estimated draw (what this PDU carries if the other feed fails). */
  deviceEstimatedWatts: number;
  wattsSource: PowerValueSource;
  /** This PDU's share of the device load: watts × plugs on this PDU / connected plugs. Rounded to 1 W. */
  estimatedWattsShare: number;
}
export interface PduSummary {
  id: string;
  rackId: string;
  source: PowerFeedSource;
  name: string | null;
  outletCount: number;
  budgetWatts: number | null;
  usedOutlets: number;
  freeOutlets: number;
  /** Sum of connection shares (normal operation). Rounded to 1 W. */
  estimatedWatts: number;
  /** Load if the other feed fails: every device with any plug here moves its full load here. Rounded to 1 W. */
  failoverWatts: number;
  levels: { outlets: LoadLevel; watts: LoadLevel; failoverWatts: LoadLevel };
  connections: PduConnectionSummary[];
}
export interface DevicePowerSummary {
  deviceId: string;
  plugCount: number;
  plugCountSource: PowerValueSource;
  estimatedWatts: number;
  wattsSource: PowerValueSource;
  connectedPlugs: number;
  /** True when the device's plugs reach both a SUPPLIER and a UPS PDU. */
  redundant: boolean;
  assignments: { plugIndex: number; pduId: string; source: PowerFeedSource; outletIndex: number }[];
}
export interface RackPowerSummary {
  mode: RackPowerMode;
  pdus: PduSummary[];
  devices: DevicePowerSummary[];
  totals: { estimatedWatts: number; bySource: Record<PowerFeedSource, number>; unconnectedDeviceIds: string[] };
}

const sourceOrder = (source: PowerFeedSource) => (source === 'SUPPLIER' ? 0 : 1);

/**
 * Builds the read model for one rack. `devices` must include every device that has an assignment on these PDUs
 * (normally the rack's devices); devices without assignments are reported as unconnected when they need power.
 */
export function summarizeRackPower(pdus: PduInput[], devices: PowerDeviceInput[]): RackPowerSummary {
  const sortedPdus = [...pdus].sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source) || a.id.localeCompare(b.id));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const assignmentsByDevice = new Map<string, { plugIndex: number; pduId: string; source: PowerFeedSource; outletIndex: number }[]>();
  for (const pdu of sortedPdus) for (const outlet of pdu.outlets) {
    const list = assignmentsByDevice.get(outlet.deviceId) ?? [];
    list.push({ plugIndex: outlet.plugIndex, pduId: pdu.id, source: pdu.source, outletIndex: outlet.outletIndex });
    assignmentsByDevice.set(outlet.deviceId, list);
  }

  const deviceSummaries: DevicePowerSummary[] = devices.map((device) => {
    const watts = resolveDeviceWatts(device);
    const plugs = resolvePlugCount(device);
    const assignments = (assignmentsByDevice.get(device.id) ?? []).sort((a, b) => a.plugIndex - b.plugIndex);
    const sources = new Set(assignments.map((item) => item.source));
    return { deviceId: device.id, plugCount: plugs.count, plugCountSource: plugs.source, estimatedWatts: watts.watts, wattsSource: watts.source, connectedPlugs: assignments.length, redundant: sources.size > 1, assignments };
  });

  const bySource: Record<PowerFeedSource, number> = { SUPPLIER: 0, UPS: 0 };
  const pduSummaries: PduSummary[] = sortedPdus.map((pdu) => {
    const byDevice = new Map<string, { outletIndex: number; plugIndex: number }[]>();
    for (const outlet of pdu.outlets) {
      const list = byDevice.get(outlet.deviceId) ?? [];
      list.push({ outletIndex: outlet.outletIndex, plugIndex: outlet.plugIndex });
      byDevice.set(outlet.deviceId, list);
    }
    let rawShare = 0;
    let rawFailover = 0;
    const connections: PduConnectionSummary[] = [];
    for (const [deviceId, outlets] of byDevice) {
      const device = deviceById.get(deviceId);
      const watts = device ? resolveDeviceWatts(device) : { watts: 0, source: 'padrão' as PowerValueSource };
      const connected = assignmentsByDevice.get(deviceId)?.length ?? outlets.length;
      const share = connected > 0 ? (watts.watts * outlets.length) / connected : 0;
      rawShare += share;
      rawFailover += watts.watts;
      connections.push({ deviceId, deviceName: device?.name ?? deviceId, deviceType: device?.type ?? 'OTHER', outlets: outlets.sort((a, b) => a.outletIndex - b.outletIndex), deviceEstimatedWatts: watts.watts, wattsSource: watts.source, estimatedWattsShare: Math.round(share) });
    }
    connections.sort((a, b) => a.outlets[0].outletIndex - b.outlets[0].outletIndex);
    bySource[pdu.source] += rawShare;
    const usedOutlets = pdu.outlets.length;
    const estimatedWatts = Math.round(rawShare);
    const failoverWatts = Math.round(rawFailover);
    return {
      id: pdu.id, rackId: pdu.rackId, source: pdu.source, name: pdu.name, outletCount: pdu.outletCount, budgetWatts: pdu.budgetWatts,
      usedOutlets, freeOutlets: Math.max(0, pdu.outletCount - usedOutlets), estimatedWatts, failoverWatts,
      levels: { outlets: outletLoadLevel(usedOutlets, pdu.outletCount), watts: wattLoadLevel(estimatedWatts, pdu.budgetWatts), failoverWatts: wattLoadLevel(failoverWatts, pdu.budgetWatts) },
      connections,
    };
  });

  const unconnectedDeviceIds = deviceSummaries.filter((item) => item.plugCount > 0 && item.connectedPlugs === 0).map((item) => item.deviceId);
  return {
    mode: rackPowerMode(sortedPdus),
    pdus: pduSummaries,
    devices: deviceSummaries,
    totals: { estimatedWatts: Math.round(bySource.SUPPLIER + bySource.UPS), bySource: { SUPPLIER: Math.round(bySource.SUPPLIER), UPS: Math.round(bySource.UPS) }, unconnectedDeviceIds },
  };
}

// ── Allocation (PUT devices/:id/power) ──────────────────────────────────────

export interface PlugRequest { plugIndex: number; pduId: string | null; outletIndex?: number | null }
export interface AllocationPdu { id: string; source: PowerFeedSource; outletCount: number; /** Outlets used by OTHER devices. */ taken: Set<number> }
export interface AllocationResult {
  assignments: { plugIndex: number; pduId: string; outletIndex: number }[];
  /** Plugs left "Não ligado" and why. Saving still succeeds. */
  unplugged: { plugIndex: number; reason: 'NOT_REQUESTED' | 'NO_FREE_OUTLET'; pduId?: string }[];
}

/**
 * Default plug → PDU mapping used when the client omits `plugs`:
 * supplier-only racks put every plug on the supplier PDU; supplier+UPS racks alternate (plug 1 Rede, plug 2 UPS, …).
 */
export function defaultPlugRequests(plugCount: number, pdus: Pick<AllocationPdu, 'id' | 'source'>[]): PlugRequest[] {
  const supplier = pdus.find((pdu) => pdu.source === 'SUPPLIER') ?? null;
  const ups = pdus.find((pdu) => pdu.source === 'UPS') ?? null;
  const requests: PlugRequest[] = [];
  for (let plugIndex = 1; plugIndex <= plugCount; plugIndex += 1) {
    const target = ups && supplier ? (plugIndex % 2 === 1 ? supplier : ups) : supplier ?? ups;
    requests.push({ plugIndex, pduId: target?.id ?? null });
  }
  return requests;
}

/**
 * Validates the requested plugs and picks outlets. Explicit outlets are placed first, then omitted outlets take
 * the lowest free outlet on their PDU (outlet 1 = top). Throws 400 for malformed input and 409 for conflicts.
 */
export function allocatePlugs(plugCount: number, requests: PlugRequest[], pdus: AllocationPdu[]): AllocationResult {
  const pduById = new Map(pdus.map((pdu) => [pdu.id, pdu]));
  const seenPlugs = new Set<number>();
  for (const request of requests) {
    if (!Number.isInteger(request.plugIndex) || request.plugIndex < 1 || request.plugIndex > plugCount) {
      throw new BadRequestException({ code: 'POWER_PLUG_OUT_OF_RANGE', message: `A ficha ${request.plugIndex} não existe: o equipamento tem ${plugCount} ficha(s).`, details: { plugIndex: request.plugIndex, plugCount } });
    }
    if (seenPlugs.has(request.plugIndex)) throw new BadRequestException({ code: 'POWER_PLUG_DUPLICATED', message: `A ficha ${request.plugIndex} foi indicada mais de uma vez.`, details: { plugIndex: request.plugIndex } });
    seenPlugs.add(request.plugIndex);
    if (request.pduId !== null && !pduById.has(request.pduId)) {
      throw new ConflictException({ code: 'PDU_NOT_IN_RACK', message: 'A PDU indicada não pertence ao bastidor do equipamento.', details: { plugIndex: request.plugIndex, pduId: request.pduId } });
    }
  }

  const usedInRequest = new Map<string, Set<number>>(pdus.map((pdu) => [pdu.id, new Set<number>()]));
  const assignments: AllocationResult['assignments'] = [];
  const unplugged: AllocationResult['unplugged'] = [];
  const ordered = [...requests].sort((a, b) => a.plugIndex - b.plugIndex);

  for (const request of ordered) {
    if (request.pduId === null || request.outletIndex === null || request.outletIndex === undefined) continue;
    const pdu = pduById.get(request.pduId)!;
    const outletIndex = request.outletIndex;
    if (!Number.isInteger(outletIndex) || outletIndex < 1 || outletIndex > pdu.outletCount) {
      throw new BadRequestException({ code: 'PDU_OUTLET_OUT_OF_RANGE', message: `A tomada ${outletIndex} não existe nesta PDU (1–${pdu.outletCount}).`, details: { plugIndex: request.plugIndex, pduId: pdu.id, outletIndex, outletCount: pdu.outletCount } });
    }
    if (pdu.taken.has(outletIndex) || usedInRequest.get(pdu.id)!.has(outletIndex)) {
      throw new ConflictException({ code: 'PDU_OUTLET_TAKEN', message: `A tomada ${outletIndex} já está ocupada. Atualiza o bastidor e escolhe outra tomada.`, details: { plugIndex: request.plugIndex, pduId: pdu.id, outletIndex } });
    }
    usedInRequest.get(pdu.id)!.add(outletIndex);
    assignments.push({ plugIndex: request.plugIndex, pduId: pdu.id, outletIndex });
  }

  for (const request of ordered) {
    if (request.pduId === null) { unplugged.push({ plugIndex: request.plugIndex, reason: 'NOT_REQUESTED' }); continue; }
    if (request.outletIndex !== null && request.outletIndex !== undefined) continue;
    const pdu = pduById.get(request.pduId)!;
    const used = usedInRequest.get(pdu.id)!;
    let picked = 0;
    for (let outlet = 1; outlet <= pdu.outletCount; outlet += 1) if (!pdu.taken.has(outlet) && !used.has(outlet)) { picked = outlet; break; }
    if (!picked) { unplugged.push({ plugIndex: request.plugIndex, reason: 'NO_FREE_OUTLET', pduId: pdu.id }); continue; }
    used.add(picked);
    assignments.push({ plugIndex: request.plugIndex, pduId: pdu.id, outletIndex: picked });
  }

  for (let plugIndex = 1; plugIndex <= plugCount; plugIndex += 1) if (!seenPlugs.has(plugIndex)) unplugged.push({ plugIndex, reason: 'NOT_REQUESTED' });
  assignments.sort((a, b) => a.plugIndex - b.plugIndex);
  unplugged.sort((a, b) => a.plugIndex - b.plugIndex);
  return { assignments, unplugged };
}

// ── PDU settings (PUT racks/:id/pdus, POST racks) ───────────────────────────

export interface PduSettingsInput { name?: string | null; outletCount?: number; budgetWatts?: number | null }
export interface RackPowerInput { mode: RackPowerMode; supplier?: PduSettingsInput; ups?: PduSettingsInput }
export interface PduWithDevices extends PduInput { outlets: (OutletAssignmentInput & { deviceName?: string })[] }
export interface PduPlan {
  create: { source: PowerFeedSource; name: string | null; outletCount: number; budgetWatts: number | null }[];
  update: { id: string; source: PowerFeedSource; data: { name?: string | null; outletCount?: number; budgetWatts?: number | null } }[];
  delete: { id: string; source: PowerFeedSource }[];
}

function affectedDevices(outlets: PduWithDevices['outlets']) {
  const map = new Map<string, { deviceId: string; deviceName: string; outlets: number[] }>();
  for (const outlet of outlets) {
    const entry = map.get(outlet.deviceId) ?? { deviceId: outlet.deviceId, deviceName: outlet.deviceName ?? outlet.deviceId, outlets: [] };
    entry.outlets.push(outlet.outletIndex);
    map.set(outlet.deviceId, entry);
  }
  return [...map.values()].map((entry) => ({ ...entry, outlets: entry.outlets.sort((a, b) => a - b) }));
}

function newPdu(source: PowerFeedSource, settings: PduSettingsInput | undefined) {
  return {
    source,
    name: settings?.name === undefined ? null : settings.name,
    outletCount: settings?.outletCount ?? DEFAULT_PDU_OUTLET_COUNT,
    budgetWatts: settings?.budgetWatts === undefined ? DEFAULT_PDU_BUDGET_WATTS : settings.budgetWatts,
  };
}

/** Plans PDU creates/updates/deletes for a power mode. 409 when removing or shrinking a PDU would orphan connections. */
export function planPduSettings(current: PduWithDevices[], input: RackPowerInput): PduPlan {
  const plan: PduPlan = { create: [], update: [], delete: [] };
  const wanted: PowerFeedSource[] = input.mode === 'SUPPLIER_AND_UPS' ? ['SUPPLIER', 'UPS'] : ['SUPPLIER'];
  for (const source of POWER_FEED_SOURCES) {
    const existing = current.find((pdu) => pdu.source === source);
    const settings = source === 'SUPPLIER' ? input.supplier : input.ups;
    if (!wanted.includes(source)) {
      if (!existing) continue;
      if (existing.outlets.length) {
        throw new ConflictException({ code: 'PDU_HAS_CONNECTIONS', message: 'Não é possível remover a PDU da UPS: ainda tem equipamentos ligados. Desliga-os primeiro.', details: { pduId: existing.id, source, devices: affectedDevices(existing.outlets) } });
      }
      plan.delete.push({ id: existing.id, source });
      continue;
    }
    if (!existing) { plan.create.push(newPdu(source, settings)); continue; }
    if (!settings) continue;
    const data: PduPlan['update'][number]['data'] = {};
    if (settings.name !== undefined) data.name = settings.name;
    if (settings.budgetWatts !== undefined) data.budgetWatts = settings.budgetWatts;
    if (settings.outletCount !== undefined) {
      const beyond = existing.outlets.filter((outlet) => outlet.outletIndex > settings.outletCount!);
      if (beyond.length) {
        throw new ConflictException({ code: 'PDU_OUTLETS_IN_USE', message: `Não é possível reduzir para ${settings.outletCount} tomadas: há equipamentos ligados em tomadas acima desse número.`, details: { pduId: existing.id, source, outletCount: settings.outletCount, devices: affectedDevices(beyond) } });
      }
      data.outletCount = settings.outletCount;
    }
    if (Object.keys(data).length) plan.update.push({ id: existing.id, source, data });
  }
  return plan;
}

/** PDUs created with a new rack (POST racks). Default: supplier only. */
export function initialPdus(input?: Partial<RackPowerInput>) {
  return planPduSettings([], { mode: input?.mode ?? 'SUPPLIER_ONLY', supplier: input?.supplier, ups: input?.ups }).create;
}
