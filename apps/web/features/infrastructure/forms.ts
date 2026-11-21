import type { PduSettingsInput, Rack, RackPowerInput, RackPowerMode } from './types';
import type { PowerDefaults } from './power';

export interface BuildingForm {
  name: string;
  description: string;
}

export interface RoomForm {
  name: string;
  buildingId: string;
}

export interface RackForm {
  name: string;
  units: string;
  roomId: string;
  modelId: string;
  frontAssetId: string;
  /** "Alimentação": power mode and per-PDU settings. Absent on older callers = "Só rede elétrica" with defaults. */
  power?: RackPowerDraft;
  /** The power settings as loaded, so an edit only sends PUT racks/:id/pdus when something changed. */
  savedPower?: RackPowerDraft;
}

/** One PDU's settings as typed in the form (strings so a field can be empty while editing). */
export interface PduDraft { name: string; outletCount: string; budgetWatts: string }
export interface RackPowerDraft { mode: RackPowerMode; supplier: PduDraft; ups: PduDraft }

/** A new PDU's settings, prefilled from the API defaults. Without them the fields stay empty and the API fills them in. */
export const emptyPduDraft = (defaults?: PowerDefaults | null): PduDraft => ({ name: '', outletCount: defaults ? String(defaults.pduOutletCount) : '', budgetWatts: defaults ? String(defaults.pduBudgetWatts) : '' });
export const emptyRackPower = (defaults?: PowerDefaults | null): RackPowerDraft => ({ mode: 'SUPPLIER_ONLY', supplier: emptyPduDraft(defaults), ups: emptyPduDraft(defaults) });

/** The form's power settings for an existing rack (its PDUs, or the defaults for a PDU it does not have). */
export function rackPowerDraft(rack: Pick<Rack, 'pdus' | 'powerMode'> | null | undefined, defaults?: PowerDefaults | null): RackPowerDraft {
  const draft = emptyRackPower(defaults);
  for (const pdu of rack?.pdus ?? []) {
    const target = pdu.source === 'UPS' ? 'ups' : 'supplier';
    draft[target] = { name: pdu.name ?? '', outletCount: String(pdu.outletCount), budgetWatts: pdu.budgetWatts == null ? '' : String(pdu.budgetWatts) };
  }
  draft.mode = rack?.powerMode ?? ((rack?.pdus ?? []).some((pdu) => pdu.source === 'UPS') ? 'SUPPLIER_AND_UPS' : 'SUPPLIER_ONLY');
  return draft;
}

/** API settings for one PDU: an empty name or budget clears it; an empty outlet count keeps the current value. */
export function pduSettings(draft: PduDraft): PduSettingsInput {
  const outletCount = Number(draft.outletCount);
  return {
    name: draft.name.trim() || null,
    ...(draft.outletCount.trim() && Number.isFinite(outletCount) ? { outletCount } : {}),
    budgetWatts: draft.budgetWatts.trim() === '' ? null : Number(draft.budgetWatts),
  };
}

/** PUT racks/:id/pdus body. The UPS settings are only sent when the rack keeps (or gets) a UPS. */
export function rackPowerInput(draft: RackPowerDraft): RackPowerInput {
  return { mode: draft.mode, supplier: pduSettings(draft.supplier), ...(draft.mode === 'SUPPLIER_AND_UPS' ? { ups: pduSettings(draft.ups) } : {}) };
}

export function rackPowerChanged(draft: RackPowerDraft | undefined, saved: RackPowerDraft | undefined): boolean {
  if (!draft) return false;
  return JSON.stringify(rackPowerInput(draft)) !== JSON.stringify(rackPowerInput(saved ?? emptyRackPower()));
}

export interface DeviceForm {
  name: string;
  type: string;
  hostname: string;
  managementIp: string;
  managementIpAddressId: string;
  rackId: string;
  rackUnitStart: string;
  rackUnitSize: string;
  modelId: string;
  status: string;
  isCritical: boolean;
  frontAssetId: string;
  backAssetId?: string;
  /** Image overrides stored when an existing device was opened; absent for a new device. */
  savedAssetIds?: { front: string; rear: string };
  /** "Fontes / fichas" (0–8). Empty = use the model's value, else 2. */
  powerPlugCount?: string;
  /** "Consumo estimado (W)". Empty = use the model's typical watts, else the type default. */
  estimatedWatts?: string;
  /** Power overrides stored when an existing device was opened; absent for a new device. */
  savedPower?: { plugs: string; watts: string };
  /** Rack when an existing device was opened (a save into another rack sends `power`); absent for a new device. */
  savedRackId?: string;
  /** API `requiredConfig.missing` of the device as opened (legacy gaps, e.g. power with no outlets). */
  requiredMissing?: string[];
  notes?: string;
  snmpEnabled?: boolean;
  snmpVersion?: 'V2C' | 'V3';
  snmpReadUsername?: string;
  snmpReadCommunity?: string;
  snmpReadAuthKey?: string;
  snmpReadPrivKey?: string;
  snmpTrapEnabled?: boolean;
  snmpTrapUsername?: string;
  snmpTrapCommunity?: string;
  snmpTrapAuthKey?: string;
  snmpTrapPrivKey?: string;
  snmpAuthProtocol?: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512';
  snmpPrivProtocol?: 'AES128' | 'AES256';
  snmpCompatibilitySha1?: boolean;
  snmpPort?: string;
  snmpIntervalMinutes?: string;
  snmpTimeoutMs?: string;
  snmpRetries?: string;
}

export interface ModelForm {
  manufacturer: string;
  model: string;
  type: string;
  supportsNetworkPorts: boolean;
  networkPortCount: string;
  frontAssetId: string;
  backAssetId: string;
}

/**
 * Image override fields for a device save. The API leaves an image alone when its field is absent and clears it on null,
 * so an edit sends a field only when the user changed it, and null only for "use the model image".
 * A new device sends only the images that were chosen.
 */
export function deviceImageFields(form: Pick<DeviceForm, 'frontAssetId' | 'backAssetId' | 'savedAssetIds'>): { frontAssetId?: string | null; backAssetId?: string | null } {
  const current = { front: form.frontAssetId ?? '', rear: form.backAssetId ?? '' };
  const fields: { frontAssetId?: string | null; backAssetId?: string | null } = {};
  const saved = form.savedAssetIds;
  if (saved ? current.front !== saved.front : current.front) fields.frontAssetId = current.front || null;
  if (saved ? current.rear !== saved.rear : current.rear) fields.backAssetId = current.rear || null;
  return fields;
}

/**
 * Power override fields for a device save, same rule as the images: an edit sends a field only when it changed (null =
 * back to the model / default); a new device sends only the values that were typed.
 */
export function devicePowerFields(form: Pick<DeviceForm, 'powerPlugCount' | 'estimatedWatts' | 'savedPower'>): { powerPlugCount?: number | null; estimatedWatts?: number | null } {
  const current = { plugs: (form.powerPlugCount ?? '').trim(), watts: (form.estimatedWatts ?? '').trim() };
  const saved = form.savedPower;
  const fields: { powerPlugCount?: number | null; estimatedWatts?: number | null } = {};
  if (saved ? current.plugs !== saved.plugs : current.plugs) fields.powerPlugCount = current.plugs === '' ? null : Number(current.plugs);
  if (saved ? current.watts !== saved.watts : current.watts) fields.estimatedWatts = current.watts === '' ? null : Number(current.watts);
  return fields;
}
