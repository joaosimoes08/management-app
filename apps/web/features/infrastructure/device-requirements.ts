'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { ApiErrorPayload } from '@/lib/api/errors';
import type { DeviceForm } from './forms';
import type { DeviceModel } from './types';

/**
 * Required device configuration, read from the API registry (GET /api/v1/devices/required-configs,
 * docs/device-required-config.md). The registry says WHICH configs exist, their tab, request fields, labels and messages;
 * this file only knows how to evaluate a known config key against the open form, and which editor field shows it.
 * A config the UI cannot evaluate is still enforced by the API and mapped back from its 400.
 */

// ── Editor tabs ──────────────────────────────────────────────────────────────

/** Editor tabs. The registry tabs (geral, localizacao, imagens, energia) plus the UI-only "Rede" tab. */
export const DEVICE_EDITOR_TABS = ['geral', 'localizacao', 'rede', 'imagens', 'energia'] as const;
export type DeviceEditorTab = typeof DEVICE_EDITOR_TABS[number];

const DEFAULT_TAB_LABELS: Record<DeviceEditorTab, string> = { geral: 'Geral', localizacao: 'Localização', rede: 'Rede', imagens: 'Imagens', energia: 'Energia' };

export function isDeviceEditorTab(value: unknown): value is DeviceEditorTab {
  return typeof value === 'string' && (DEVICE_EDITOR_TABS as readonly string[]).includes(value);
}

export function deviceEditorTabLabel(tab: DeviceEditorTab, registry?: RequiredConfigRegistry | null): string {
  return registry?.tabs.find((item) => item.key === tab)?.label ?? DEFAULT_TAB_LABELS[tab];
}

// ── Registry (API) ───────────────────────────────────────────────────────────

export interface RequiredConfigEntry {
  key: string;
  kind: 'CORE' | 'FEATURE';
  tab: string;
  fields: string[];
  label: string;
  missingMessage: string;
  appliesWhen?: string;
}
export interface RequiredConfigRegistry { tabs: { key: string; label: string }[]; configs: RequiredConfigEntry[] }

export const REQUIRED_CONFIGS_QUERY_KEY = ['infrastructure', 'device-required-configs'] as const;

export function getRequiredConfigRegistry(): Promise<RequiredConfigRegistry> {
  return apiFetch<RequiredConfigRegistry>('/api/v1/devices/required-configs');
}

/** The registry, cached for the session. `null` while loading or if it failed (the API still validates every save). */
export function useRequiredConfigRegistry(): RequiredConfigRegistry | null {
  const { data } = useQuery({ queryKey: REQUIRED_CONFIGS_QUERY_KEY, queryFn: getRequiredConfigRegistry, staleTime: Infinity, gcTime: Infinity, retry: 1 });
  return data ?? null;
}

// ── Request field → editor field ─────────────────────────────────────────────

/** API request field → editor field id and tab (used for registry `fields` and for 400 errors). */
const FIELD_TARGETS: Record<string, { fieldId: string; tab: DeviceEditorTab }> = {
  name: { fieldId: 'device-name', tab: 'geral' },
  type: { fieldId: 'device-type', tab: 'geral' },
  status: { fieldId: 'device-status', tab: 'geral' },
  modelId: { fieldId: 'device-model', tab: 'geral' },
  siteId: { fieldId: 'device-rack', tab: 'localizacao' },
  rackId: { fieldId: 'device-rack', tab: 'localizacao' },
  rackUnitStart: { fieldId: 'device-rack-unit-start', tab: 'localizacao' },
  rackUnitSize: { fieldId: 'device-rack-unit-size', tab: 'localizacao' },
  hostname: { fieldId: 'device-hostname', tab: 'rede' },
  managementIp: { fieldId: 'device-management-ip', tab: 'rede' },
  managementIpAddressId: { fieldId: 'device-ipam', tab: 'rede' },
  frontAssetId: { fieldId: 'device-front-image', tab: 'imagens' },
  backAssetId: { fieldId: 'device-rear-image', tab: 'imagens' },
  power: { fieldId: 'device-power-plugs', tab: 'energia' },
  powerPlugCount: { fieldId: 'device-power-plugs', tab: 'energia' },
  estimatedWatts: { fieldId: 'device-power-watts', tab: 'energia' },
};
/** Field to focus when an error only names a tab. */
const TAB_FIELD: Record<DeviceEditorTab, string> = { geral: 'device-name', localizacao: 'device-rack', rede: 'device-hostname', imagens: 'device-rear-image', energia: 'device-power-plugs' };

function targetFor(fields: readonly string[], tab?: string): { fieldId: string; tab: DeviceEditorTab } | undefined {
  for (const field of fields) {
    const target = FIELD_TARGETS[field] ?? FIELD_TARGETS[field.split('.')[0]] ?? FIELD_TARGETS[field.split('.').pop() ?? ''];
    if (target) return target;
  }
  return isDeviceEditorTab(tab) ? { fieldId: TAB_FIELD[tab], tab } : undefined;
}

// ── Evaluating the open form ─────────────────────────────────────────────────

export interface RequirementContext {
  model: DeviceModel | null;
  /** Placement fallback when the form has no rack: the Site the editor saves into. */
  siteId?: string | null;
  /** Plug count when neither the device nor its model has one (API power defaults). */
  defaultPlugCount?: number | null;
  isNew: boolean;
  /** True when the save will send `power` (outlets assigned by the API in the same transaction). */
  sendsPower: boolean;
  /** Existing device as the editor opened it, and its model: the baseline for "placement change". */
  opened?: DeviceForm | null;
  openedModel?: DeviceModel | null;
}

function plugCount(form: DeviceForm, model: DeviceModel | null | undefined, defaultPlugCount: number | null | undefined): number {
  return form.powerPlugCount?.trim() ? Number(form.powerPlugCount) : (model?.powerPlugCount ?? defaultPlugCount ?? 2);
}

/**
 * The status the API will store for this save (infrastructure.service createDevice / updateDevice): a save with a rack
 * forces ACTIVE unless the device is RETIRED now (update) or is created as RETIRED. So picking RETIRED while racking an
 * ACTIVE/UNKNOWN device still stores ACTIVE.
 */
export function effectiveStatus(form: DeviceForm, context: Pick<RequirementContext, 'isNew' | 'opened'>): string {
  if (!form.rackId) return form.status;
  if (context.isNew) return form.status === 'RETIRED' ? form.status : 'ACTIVE';
  return context.opened && context.opened.status !== 'RETIRED' ? 'ACTIVE' : form.status;
}

/**
 * Whether the save places the device in a rack, which the API treats like a create there (rear image + power required,
 * MISSING): a new racked device, entering a rack from Site only, moving to another rack, leaving RETIRED inside a rack, or
 * going from 0 plugs to some. Staying in the same rack, or leaving a rack, is not a placement.
 */
export function isPlacementChange(form: DeviceForm, context: Omit<RequirementContext, 'sendsPower'>): boolean {
  if (!form.rackId || effectiveStatus(form, context) === 'RETIRED') return false;
  if (context.isNew) return true;
  const opened = context.opened;
  const openedRack = opened ? opened.rackId ?? '' : form.savedRackId ?? '';
  if (form.rackId !== openedRack) return true;
  if (!opened) return false;
  if (opened.status === 'RETIRED') return true;
  return plugCount(opened, context.openedModel, context.defaultPlugCount) <= 0 && plugCount(form, context.model, context.defaultPlugCount) > 0;
}

/** Whether a config applies to the form and whether it is satisfied; `undefined` for a key the UI cannot evaluate. */
export function configStatus(key: string, form: DeviceForm, context: RequirementContext): { applies: boolean; satisfied: boolean } | undefined {
  const racked = Boolean(form.rackId) && effectiveStatus(form, context) !== 'RETIRED';
  switch (key) {
    case 'name': return { applies: true, satisfied: Boolean(form.name.trim()) };
    case 'type': return { applies: true, satisfied: Boolean(form.type.trim()) };
    case 'placement': return { applies: true, satisfied: Boolean(form.rackId || context.siteId) };
    case 'rearImage': return { applies: racked, satisfied: Boolean(form.backAssetId || context.model?.backAssetId || context.model?.backAsset?.id) };
    case 'power': {
      const applies = racked && plugCount(form, context.model, context.defaultPlugCount) > 0;
      // Satisfied by the save itself (it sends `power`) or, for an existing device, by the outlets it already has.
      return { applies, satisfied: context.sendsPower || (!context.isNew && !(form.requiredMissing ?? []).includes('power')) };
    }
    default: return undefined;
  }
}

/**
 * Whether the save sends `power` (`{}` = the API's default outlet distribution, in the same transaction): a placement
 * change (see isPlacementChange) of a device with at least one plug. Required by the API for those saves.
 */
export function saveSendsPower(form: DeviceForm, context: Omit<RequirementContext, 'sendsPower'>): boolean {
  return plugCount(form, context.model, context.defaultPlugCount) > 0 && isPlacementChange(form, context);
}

export interface RequirementState {
  config: RequiredConfigEntry;
  fieldId: string;
  tab: DeviceEditorTab;
  /** Blocks Guardar; otherwise a "configuração em falta" hint for a legacy device. */
  blocking: boolean;
}

/** FEATURE configs a placement change must bring (API: MISSING even for a legacy device). */
const PLACEMENT_CONFIGS = new Set(['rearImage', 'power']);

/**
 * What is missing now, per the API rule. A new device must satisfy every config that applies. An existing device is
 * always blocked by a CORE config; a FEATURE config blocks when it was satisfied when the editor opened (the save would
 * clear it) or, for rear image and power, when the save is a placement change; else it is a non-blocking hint.
 */
export function evaluateDeviceRequirements(registry: RequiredConfigRegistry | null, form: DeviceForm, context: RequirementContext, options: { isNew: boolean; satisfiedAtOpen?: ReadonlySet<string> }): RequirementState[] {
  const configs = registry?.configs ?? [];
  const states: RequirementState[] = [];
  for (const config of configs) {
    const status = configStatus(config.key, form, context);
    if (!status || !status.applies || status.satisfied) continue;
    const target = targetFor(config.fields, config.tab);
    if (!target) continue;
    const blocking = options.isNew || config.kind === 'CORE' || (options.satisfiedAtOpen?.has(config.key) ?? false)
      || (PLACEMENT_CONFIGS.has(config.key) && isPlacementChange(form, context));
    states.push({ config, fieldId: target.fieldId, tab: target.tab, blocking });
  }
  return states;
}

/** FEATURE configs the device satisfied (where they applied) when the editor opened: clearing one of them blocks the save. */
export function satisfiedFeatureConfigs(registry: RequiredConfigRegistry | null, form: DeviceForm, context: RequirementContext): Set<string> {
  return new Set((registry?.configs ?? []).filter((config) => config.kind === 'FEATURE').filter((config) => {
    const status = configStatus(config.key, form, context);
    return status?.applies && status.satisfied;
  }).map((config) => config.key));
}

// ── API 400 errors ───────────────────────────────────────────────────────────

export interface MappedFieldError { fieldId: string; tab: DeviceEditorTab; message: string }

type RawError = { config?: unknown; tab?: unknown; fields?: unknown; field?: unknown; property?: unknown; message?: unknown; constraints?: unknown };

/**
 * Field errors from a device save 400, mapped onto editor fields:
 * - REQUIRED_CONFIG_MISSING: `details.errors[{ config, tab, fields, reason, message }]`;
 * - VALIDATION_ERROR: `details.errors` as plain strings ("name must be …"), mapped by their first word.
 */
export function mapApiFieldErrors(payload: ApiErrorPayload | undefined | null): MappedFieldError[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : {};
  const source = details.errors ?? record.errors;
  if (!Array.isArray(source)) return [];
  const mapped: MappedFieldError[] = [];
  for (const item of source as Array<RawError | string>) {
    let target: { fieldId: string; tab: DeviceEditorTab } | undefined;
    let message = '';
    if (typeof item === 'string') {
      target = targetFor([item.trim().split(/\s+/)[0] ?? '']);
      message = item;
    } else if (item && typeof item === 'object') {
      const fields = Array.isArray(item.fields) ? item.fields.filter((field): field is string => typeof field === 'string') : [item.field, item.property].filter((field): field is string => typeof field === 'string');
      target = targetFor(fields, typeof item.tab === 'string' ? item.tab : undefined);
      message = typeof item.message === 'string' ? item.message : item.constraints && typeof item.constraints === 'object' ? Object.values(item.constraints).filter((value) => typeof value === 'string').join(' ') : '';
    }
    if (!target || mapped.some((entry) => entry.fieldId === target.fieldId)) continue;
    mapped.push({ ...target, message: message || 'Valor inválido.' });
  }
  return mapped;
}

// ── Deep links (contract: docs/device-required-config.md) ───────────────────

/** /infraestrutura?siteId=…&tab=devices&deviceId=…&settingsTab=… opens a device's settings on one tab. */
export function deviceSettingsHref(deviceId: string, tab?: DeviceEditorTab, siteId?: string | null): string {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  params.set('tab', 'devices');
  params.set('deviceId', deviceId);
  if (tab) params.set('settingsTab', tab);
  return `/infraestrutura?${params.toString()}`;
}

/** The settings tab a deep link asks for (`settingsTab`), when it names a real tab. */
export function settingsTabFromSearch(search: string): DeviceEditorTab | undefined {
  const requested = new URLSearchParams(search).get('settingsTab');
  return isDeviceEditorTab(requested) ? requested : undefined;
}

/**
 * Whether a `missingConfig` link asks for the cross-site list: `allSites=1`, or (older alert links) no siteId at all.
 * The bell counts every Site the user can manage, so its list must not be narrowed to the active Site.
 */
export function missingConfigAllSitesFromSearch(search: string): boolean {
  const query = new URLSearchParams(search);
  if (!missingConfigFromSearch(search)) return false;
  return query.get('allSites') === '1' || !query.get('siteId');
}

/** `missingConfig` list filter from a deep link (rearImage | power, or any key the registry adds). */
export function missingConfigFromSearch(search: string): string {
  const requested = new URLSearchParams(search).get('missingConfig') ?? '';
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(requested) ? requested : '';
}
