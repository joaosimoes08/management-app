/**
 * Required device configurations — the ONE registry of what a device must have filled in.
 *
 * Adding a new required configuration (e.g. a future feature):
 *   1. Add an entry to DEVICE_REQUIRED_CONFIGS (key, tab, fields, pt-PT labels).
 *   2. Teach `deviceConfigStatus` how to decide `applies` / `satisfied` from a DeviceConfigState.
 *   3. Teach `missingConfigWhere` the same rule as a Prisma filter (the spec checks both agree).
 *   4. If the value comes from a new column, load it in DEVICE_CONFIG_SELECT / toDeviceConfigState.
 * The web app reads the registry from GET /api/v1/devices/required-configs, so it needs no copy.
 *
 * Rule (docs/device-required-config.md):
 *   - CORE configs are always enforced on create and update.
 *   - FEATURE configs are enforced on create (POST /devices) and whenever a save places the device somewhere the
 *     config starts to apply (enters a rack, moves to another rack, leaves RETIRED, 0 → n plugs): reason MISSING.
 *     A legacy device that stays where it is may keep a gap while other fields are edited, but a save that turns
 *     a satisfied feature config into an unsatisfied one is rejected (reason CLEARED). See updateViolations.
 *   - Unsatisfied FEATURE configs feed the topbar bell as one grouped alert per config.
 */
import { DEFAULT_POWER_PLUG_COUNT } from '../power/power-defaults';

export type DeviceConfigKey = 'name' | 'type' | 'placement' | 'rearImage' | 'power';
export type DeviceSettingsTab = 'geral' | 'localizacao' | 'imagens' | 'energia';
export type DeviceConfigKind = 'CORE' | 'FEATURE';

export interface DeviceRequiredConfig {
  key: DeviceConfigKey;
  kind: DeviceConfigKind;
  /** Device settings tab that holds the fields (URL value for `settingsTab`). */
  tab: DeviceSettingsTab;
  /** Request fields the UI should highlight when the config is missing. */
  fields: string[];
  label: string;
  /** Shown under the field / in the tab when missing. */
  missingMessage: string;
  /** When the config applies, in plain words (pt-PT), for the UI tooltip. */
  appliesWhen: string;
  /** Grouped bell alert title: singular / plural (`{count}` is replaced). FEATURE only. */
  alertTitle?: { one: string; other: string };
  alertDetail?: string;
}

export const DEVICE_SETTINGS_TABS: readonly { key: DeviceSettingsTab; label: string }[] = Object.freeze([
  { key: 'geral', label: 'Geral' },
  { key: 'localizacao', label: 'Localização' },
  { key: 'imagens', label: 'Imagens' },
  { key: 'energia', label: 'Energia' },
]);

export const DEVICE_REQUIRED_CONFIGS: readonly DeviceRequiredConfig[] = Object.freeze([
  { key: 'name', kind: 'CORE', tab: 'geral', fields: ['name'], label: 'Nome', missingMessage: 'Indica o nome do equipamento.', appliesWhen: 'Sempre.' },
  { key: 'type', kind: 'CORE', tab: 'geral', fields: ['type'], label: 'Tipo', missingMessage: 'Escolhe o tipo de equipamento.', appliesWhen: 'Sempre.' },
  { key: 'placement', kind: 'CORE', tab: 'localizacao', fields: ['siteId', 'rackId'], label: 'Site ou bastidor', missingMessage: 'Seleciona um Site ou bastidor para o equipamento.', appliesWhen: 'Sempre.' },
  {
    key: 'rearImage', kind: 'FEATURE', tab: 'imagens', fields: ['backAssetId'], label: 'Imagem traseira',
    missingMessage: 'Carrega a imagem traseira do equipamento ou escolhe um modelo que já a tenha.',
    appliesWhen: 'Equipamentos num bastidor que não estão abatidos. A imagem do modelo conta.',
    alertTitle: { one: '1 dispositivo sem imagem traseira', other: '{count} dispositivos sem imagem traseira' },
    alertDetail: 'A vista traseira do bastidor não os consegue mostrar.',
  },
  {
    key: 'power', kind: 'FEATURE', tab: 'energia', fields: ['power', 'powerPlugCount'], label: 'Tomadas de energia',
    missingMessage: 'Liga pelo menos uma ficha a uma tomada da PDU, ou indica 0 fichas se o equipamento não tem alimentação.',
    appliesWhen: 'Equipamentos num bastidor, não abatidos, com pelo menos 1 ficha.',
    alertTitle: { one: '1 dispositivo sem tomadas de energia configuradas', other: '{count} dispositivos sem tomadas de energia configuradas' },
    alertDetail: 'A carga das PDUs não inclui estes equipamentos.',
  },
]);

export const FEATURE_CONFIG_KEYS = DEVICE_REQUIRED_CONFIGS.filter((item) => item.kind === 'FEATURE').map((item) => item.key) as ('rearImage' | 'power')[];
export type FeatureConfigKey = 'rearImage' | 'power';

export function requiredConfig(key: DeviceConfigKey): DeviceRequiredConfig {
  const config = DEVICE_REQUIRED_CONFIGS.find((item) => item.key === key);
  if (!config) throw new Error(`Unknown device config ${key}`);
  return config;
}
export function isFeatureConfigKey(value: unknown): value is FeatureConfigKey {
  return typeof value === 'string' && (FEATURE_CONFIG_KEYS as string[]).includes(value);
}

/** Everything the rules need about one device (current or as it will be after the save). */
export interface DeviceConfigState {
  name?: string | null;
  type?: string | null;
  siteId?: string | null;
  rackId?: string | null;
  status?: string | null;
  backAssetId?: string | null;
  modelBackAssetId?: string | null;
  powerPlugCount?: number | null;
  modelPowerPlugCount?: number | null;
  /** Plugs connected to a PDU outlet. */
  connectedPlugs: number;
}

export interface DeviceConfigStatus { key: DeviceConfigKey; applies: boolean; satisfied: boolean }

function effectivePlugCount(state: DeviceConfigState) {
  return state.powerPlugCount ?? state.modelPowerPlugCount ?? DEFAULT_POWER_PLUG_COUNT;
}

export function deviceConfigStatus(state: DeviceConfigState): DeviceConfigStatus[] {
  const racked = Boolean(state.rackId) && state.status !== 'RETIRED';
  return DEVICE_REQUIRED_CONFIGS.map(({ key }) => {
    switch (key) {
      case 'name': return { key, applies: true, satisfied: Boolean(state.name?.trim()) };
      case 'type': return { key, applies: true, satisfied: Boolean(state.type?.trim()) };
      case 'placement': return { key, applies: true, satisfied: Boolean(state.siteId || state.rackId) };
      case 'rearImage': return { key, applies: racked, satisfied: Boolean(state.backAssetId || state.modelBackAssetId) };
      case 'power': { const applies = racked && effectivePlugCount(state) > 0; return { key, applies, satisfied: state.connectedPlugs > 0 }; }
    }
  });
}

/** Keys that apply and are not satisfied. */
export function missingConfigs(state: DeviceConfigState): DeviceConfigKey[] {
  return deviceConfigStatus(state).filter((item) => item.applies && !item.satisfied).map((item) => item.key);
}

/** Per-device payload added to GET /devices and GET /devices/:id as `requiredConfig`. */
export function requiredConfigSummary(state: DeviceConfigState) {
  const missing = missingConfigs(state);
  return { missing, missingTabs: [...new Set(missing.map((key) => requiredConfig(key).tab))], complete: missing.length === 0 };
}

export type MissingConfigReason = 'MISSING' | 'CLEARED' | 'NO_FREE_OUTLET';
export interface RequiredConfigError { config: DeviceConfigKey; tab: DeviceSettingsTab; fields: string[]; reason: MissingConfigReason; message: string }

export function requiredConfigError(key: DeviceConfigKey, reason: MissingConfigReason, message?: string): RequiredConfigError {
  const config = requiredConfig(key);
  return { config: key, tab: config.tab, fields: config.fields, reason, message: message ?? config.missingMessage };
}

/** Create: every config that applies must be satisfied. */
export function createViolations(next: DeviceConfigState): RequiredConfigError[] {
  return missingConfigs(next).map((key) => requiredConfigError(key, 'MISSING'));
}

/**
 * Update: CORE configs must be satisfied. A FEATURE config that applies after the save and is not satisfied is:
 *   - CLEARED  when it was satisfied before (a save must never empty a filled config);
 *   - MISSING  when the requirement starts with this save: it did not apply before (e.g. the device enters a rack
 *              from a Site, leaves RETIRED, or goes from 0 plugs to some) or the device moves to another rack.
 *              Placing a device is treated like creating it there;
 *   - allowed  otherwise: a legacy device already in the same rack keeps its gap while unrelated fields are edited.
 * `keys` limits the check (e.g. only 'power').
 */
export function updateViolations(before: DeviceConfigState, after: DeviceConfigState, keys?: DeviceConfigKey[]): RequiredConfigError[] {
  const previous = new Map(deviceConfigStatus(before).map((item) => [item.key, item]));
  const rackChanged = (before.rackId ?? null) !== (after.rackId ?? null);
  const errors: RequiredConfigError[] = [];
  for (const item of deviceConfigStatus(after)) {
    if (keys && !keys.includes(item.key)) continue;
    if (!item.applies || item.satisfied) continue;
    if (requiredConfig(item.key).kind === 'CORE') { errors.push(requiredConfigError(item.key, 'MISSING')); continue; }
    const was = previous.get(item.key)!;
    if (was.applies && was.satisfied) errors.push(requiredConfigError(item.key, 'CLEARED'));
    else if (!was.applies || rackChanged) errors.push(requiredConfigError(item.key, 'MISSING'));
  }
  return errors;
}

/** Prisma `where` for devices missing a FEATURE config. Must match deviceConfigStatus (see spec). */
export function missingConfigWhere(key: FeatureConfigKey) {
  const racked = { rackId: { not: null }, status: { not: 'RETIRED' as const } };
  if (key === 'rearImage') return { ...racked, backAssetId: null, OR: [{ modelId: null }, { model: { backAssetId: null } }] };
  const modelPlugsPositive = DEFAULT_POWER_PLUG_COUNT > 0
    ? [{ modelId: null }, { model: { powerPlugCount: null } }, { model: { powerPlugCount: { gt: 0 } } }]
    : [{ model: { powerPlugCount: { gt: 0 } } }];
  return { ...racked, pduOutlets: { none: {} }, OR: [{ powerPlugCount: { gt: 0 } }, { powerPlugCount: null, OR: modelPlugsPositive }] };
}

/** Prisma select that loads what toDeviceConfigState needs. */
export const DEVICE_CONFIG_SELECT = {
  id: true, name: true, type: true, siteId: true, rackId: true, status: true, backAssetId: true, powerPlugCount: true,
  model: { select: { backAssetId: true, powerPlugCount: true } },
  _count: { select: { pduOutlets: true } },
} as const;

export function toDeviceConfigState(device: {
  name?: string | null; type?: string | null; siteId?: string | null; rackId?: string | null; status?: string | null;
  backAssetId?: string | null; powerPlugCount?: number | null;
  model?: { backAssetId?: string | null; powerPlugCount?: number | null } | null;
  _count?: { pduOutlets?: number };
}): DeviceConfigState {
  return {
    name: device.name, type: device.type, siteId: device.siteId, rackId: device.rackId, status: device.status,
    backAssetId: device.backAssetId, modelBackAssetId: device.model?.backAssetId ?? null,
    powerPlugCount: device.powerPlugCount, modelPowerPlugCount: device.model?.powerPlugCount ?? null,
    connectedPlugs: device._count?.pduOutlets ?? 0,
  };
}

/** Public registry payload for GET /api/v1/devices/required-configs. */
export function requiredConfigRegistry() {
  return {
    tabs: DEVICE_SETTINGS_TABS,
    configs: DEVICE_REQUIRED_CONFIGS.map(({ key, kind, tab, fields, label, missingMessage, appliesWhen }) => ({ key, kind, tab, fields, label, missingMessage, appliesWhen })),
  };
}

/** Device settings deep link (contract with the web app). */
export function deviceSettingsHref(device: { id: string; siteId?: string | null }, tab: DeviceSettingsTab) {
  const query = new URLSearchParams({ ...(device.siteId ? { siteId: device.siteId } : {}), tab: 'devices', deviceId: device.id, settingsTab: tab });
  return `/infraestrutura?${query.toString()}`;
}
/** Filtered devices list deep link (contract with the web app). */
export function missingConfigListHref(key: FeatureConfigKey, siteId?: string | null) {
  const query = new URLSearchParams({ ...(siteId ? { siteId } : {}), tab: 'devices', missingConfig: key });
  return `/infraestrutura?${query.toString()}`;
}
