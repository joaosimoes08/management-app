import type { ApiErrorPayload } from '@/lib/api/errors';
import type { DeviceForm } from './forms';
import type { DeviceModel } from './types';

/**
 * Required device configuration: the one place the device editor reads what must be filled, on which tab, and which
 * requirements came after devices already existed (those only warn on an existing device that never had them).
 * Mirrors the API's shared registry so the UI blocks the same saves the API rejects.
 */

export const DEVICE_EDITOR_TABS = ['geral', 'localizacao', 'rede', 'imagens', 'energia'] as const;
export type DeviceEditorTab = typeof DEVICE_EDITOR_TABS[number];

export const deviceEditorTabLabels: Record<DeviceEditorTab, string> = {
  geral: 'Geral',
  localizacao: 'Localização',
  rede: 'Rede',
  imagens: 'Imagens',
  energia: 'Energia',
};

export function isDeviceEditorTab(value: unknown): value is DeviceEditorTab {
  return typeof value === 'string' && (DEVICE_EDITOR_TABS as readonly string[]).includes(value);
}

export type DeviceRequirementKey = 'name' | 'rearImage' | 'powerPlugCount' | 'estimatedWatts';

export interface DeviceRequirement {
  key: DeviceRequirementKey;
  tab: DeviceEditorTab;
  /** DOM id of the field to focus. */
  fieldId: string;
  /** pt-PT error shown under the field. */
  message: string;
  /** Added after devices already existed: an existing device without it may still be saved (it only gets a hint). */
  legacyOptional: boolean;
  /** Whether it applies to this device at all (e.g. the rear image only for a device placed in a rack). */
  appliesTo: (form: DeviceForm) => boolean;
  /** True when the device has no value for it, counting what it inherits from its model. */
  isMissing: (form: DeviceForm, model: DeviceModel | null) => boolean;
}

const blank = (value: string | null | undefined) => (value ?? '').trim() === '';

export const DEVICE_REQUIREMENTS: readonly DeviceRequirement[] = [
  {
    key: 'name', tab: 'geral', fieldId: 'device-name', legacyOptional: false,
    message: 'O nome é obrigatório.',
    appliesTo: () => true,
    isMissing: (form) => blank(form.name),
  },
  {
    key: 'rearImage', tab: 'imagens', fieldId: 'device-rear-image', legacyOptional: true,
    message: 'A imagem traseira é obrigatória para equipamentos num bastidor. Escolhe uma imagem ou um modelo que a tenha.',
    appliesTo: (form) => !blank(form.rackId),
    isMissing: (form, model) => blank(form.backAssetId) && !(model?.backAssetId || model?.backAsset?.id),
  },
  {
    key: 'powerPlugCount', tab: 'energia', fieldId: 'device-power-plugs', legacyOptional: true,
    message: 'Indica o número de fontes / fichas (0 se não tiver alimentação).',
    appliesTo: () => true,
    isMissing: (form, model) => blank(form.powerPlugCount) && model?.powerPlugCount == null,
  },
  {
    key: 'estimatedWatts', tab: 'energia', fieldId: 'device-power-watts', legacyOptional: true,
    message: 'Indica o consumo estimado em W.',
    appliesTo: () => true,
    isMissing: (form, model) => blank(form.estimatedWatts) && model?.typicalWatts == null,
  },
];

export interface RequirementState {
  requirement: DeviceRequirement;
  /** Blocks Guardar. */
  blocking: boolean;
}

/**
 * What is missing now. A new device must fill every requirement that applies. An existing device is blocked only by a
 * requirement that is not legacy-optional, or one it had when the editor opened (it may not clear a filled value);
 * a legacy gap it already had is returned as non-blocking so the tab can show "configuração em falta".
 */
export function evaluateDeviceRequirements(form: DeviceForm, model: DeviceModel | null, options: { isNew: boolean; missingAtOpen?: ReadonlySet<DeviceRequirementKey> }): RequirementState[] {
  return DEVICE_REQUIREMENTS
    .filter((requirement) => requirement.appliesTo(form) && requirement.isMissing(form, model))
    .map((requirement) => ({
      requirement,
      blocking: options.isNew || !requirement.legacyOptional || !(options.missingAtOpen?.has(requirement.key) ?? false),
    }));
}

/** Requirement keys missing on the device as it was opened (the legacy baseline for an existing device). */
export function missingRequirementKeys(form: DeviceForm, model: DeviceModel | null): Set<DeviceRequirementKey> {
  return new Set(DEVICE_REQUIREMENTS.filter((requirement) => requirement.appliesTo(form) && requirement.isMissing(form, model)).map((requirement) => requirement.key));
}

export function requirementForKey(key: string): DeviceRequirement | undefined {
  return DEVICE_REQUIREMENTS.find((requirement) => requirement.key === key);
}

// ── API field errors ─────────────────────────────────────────────────────────

/** API body field → editor field id and tab. Requirement fields come from the registry above. */
const API_FIELD_TARGETS: Record<string, { fieldId: string; tab: DeviceEditorTab }> = {
  name: { fieldId: 'device-name', tab: 'geral' },
  type: { fieldId: 'device-type', tab: 'geral' },
  status: { fieldId: 'device-status', tab: 'geral' },
  modelId: { fieldId: 'device-model', tab: 'geral' },
  rackId: { fieldId: 'device-rack', tab: 'localizacao' },
  rackUnitStart: { fieldId: 'device-rack-unit-start', tab: 'localizacao' },
  rackUnitSize: { fieldId: 'device-rack-unit-size', tab: 'localizacao' },
  hostname: { fieldId: 'device-hostname', tab: 'rede' },
  managementIp: { fieldId: 'device-management-ip', tab: 'rede' },
  managementIpAddressId: { fieldId: 'device-ipam', tab: 'rede' },
  frontAssetId: { fieldId: 'device-front-image', tab: 'imagens' },
  backAssetId: { fieldId: 'device-rear-image', tab: 'imagens' },
  rearImage: { fieldId: 'device-rear-image', tab: 'imagens' },
  powerPlugCount: { fieldId: 'device-power-plugs', tab: 'energia' },
  estimatedWatts: { fieldId: 'device-power-watts', tab: 'energia' },
};

export interface MappedFieldError { fieldId: string; tab: DeviceEditorTab; message: string }

type RawFieldError = { field?: unknown; path?: unknown; property?: unknown; key?: unknown; message?: unknown; messages?: unknown; constraints?: unknown };

function messageOf(entry: RawFieldError | string | string[]): string {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) return entry.filter((item) => typeof item === 'string').join(' ');
  if (typeof entry.message === 'string') return entry.message;
  if (Array.isArray(entry.messages)) return entry.messages.filter((item) => typeof item === 'string').join(' ');
  if (entry.constraints && typeof entry.constraints === 'object') return Object.values(entry.constraints as Record<string, unknown>).filter((item) => typeof item === 'string').join(' ');
  return '';
}

/**
 * Field-level errors from a 400 response, mapped onto editor fields. Accepts `fields` / `errors` / `details.fields` as
 * an array of `{ field|path|property, message }` or as a `{ field: message }` record. Unknown fields are left out
 * (the general banner still shows the message).
 */
export function mapApiFieldErrors(payload: ApiErrorPayload | undefined | null): MappedFieldError[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : {};
  const source = record.fields ?? record.errors ?? details.fields ?? details.errors;
  const entries: Array<[string, string]> = [];
  if (Array.isArray(source)) {
    for (const item of source as RawFieldError[]) {
      if (!item || typeof item !== 'object') continue;
      const field = [item.field, item.path, item.property, item.key].find((value) => typeof value === 'string' || Array.isArray(value));
      const name = Array.isArray(field) ? field.join('.') : field as string | undefined;
      if (name) entries.push([name, messageOf(item)]);
    }
  } else if (source && typeof source === 'object') {
    for (const [name, value] of Object.entries(source as Record<string, unknown>)) entries.push([name, messageOf(value as RawFieldError | string | string[])]);
  }
  const mapped: MappedFieldError[] = [];
  for (const [name, message] of entries) {
    const target = API_FIELD_TARGETS[name] ?? API_FIELD_TARGETS[name.split('.').pop() ?? ''];
    if (!target || mapped.some((item) => item.fieldId === target.fieldId)) continue;
    const requirement = DEVICE_REQUIREMENTS.find((item) => item.fieldId === target.fieldId);
    mapped.push({ ...target, message: message || requirement?.message || 'Valor inválido.' });
  }
  return mapped;
}

/** Deep link that opens a device's settings on one tab: /infraestrutura?focus=device&deviceId=…&deviceTab=…. */
export function deviceSettingsHref(deviceId: string, tab?: DeviceEditorTab, siteId?: string | null): string {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  params.set('focus', 'device');
  params.set('deviceId', deviceId);
  if (tab) params.set('deviceTab', tab);
  return `/infraestrutura?${params.toString()}`;
}

/** The editor tab a deep link asks for (`deviceTab`), when it names a real tab. */
export function deviceTabFromSearch(search: string): DeviceEditorTab | undefined {
  const requested = new URLSearchParams(search).get('deviceTab');
  return isDeviceEditorTab(requested) ? requested : undefined;
}

/** Editor tab of the first missing requirement key, for alert links (keys as the API reports them). */
export function tabForMissingKeys(keys: readonly string[]): DeviceEditorTab | undefined {
  for (const key of keys) {
    const target = requirementForKey(key)?.tab ?? API_FIELD_TARGETS[key]?.tab;
    if (target) return target;
    // Registry codes such as REAR_IMAGE / POWER_OUTLETS / ESTIMATED_WATTS.
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (/rear|back/.test(normalized)) return 'imagens';
    if (/power|plug|outlet|watt/.test(normalized)) return 'energia';
  }
  return undefined;
}
