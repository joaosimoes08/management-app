import { describe, expect, it } from 'vitest';
import type { DeviceForm } from './forms';
import type { DeviceModel } from './types';
import {
  deviceSettingsHref, effectiveStatus, evaluateDeviceRequirements, mapApiFieldErrors, missingConfigAllSitesFromSearch, missingConfigFromSearch, satisfiedFeatureConfigs, saveSendsPower, settingsTabFromSearch,
  type RequiredConfigRegistry,
} from './device-requirements';

/** GET /api/v1/devices/required-configs as served by the API (docs/device-required-config.md). */
const registryFixture: RequiredConfigRegistry = {
  tabs: [{ key: 'geral', label: 'Geral' }, { key: 'localizacao', label: 'Localização' }, { key: 'imagens', label: 'Imagens' }, { key: 'energia', label: 'Energia' }],
  configs: [
    { key: 'name', kind: 'CORE', tab: 'geral', fields: ['name'], label: 'Nome', missingMessage: 'Indica o nome do equipamento.' },
    { key: 'type', kind: 'CORE', tab: 'geral', fields: ['type'], label: 'Tipo', missingMessage: 'Escolhe o tipo de equipamento.' },
    { key: 'placement', kind: 'CORE', tab: 'localizacao', fields: ['siteId', 'rackId'], label: 'Site ou bastidor', missingMessage: 'Seleciona um Site ou bastidor para o equipamento.' },
    { key: 'rearImage', kind: 'FEATURE', tab: 'imagens', fields: ['backAssetId'], label: 'Imagem traseira', missingMessage: 'Carrega a imagem traseira do equipamento ou escolhe um modelo que já a tenha.' },
    { key: 'power', kind: 'FEATURE', tab: 'energia', fields: ['power', 'powerPlugCount'], label: 'Tomadas de energia', missingMessage: 'Liga pelo menos uma ficha a uma tomada da PDU, ou indica 0 fichas se o equipamento não tem alimentação.' },
  ],
};

const form: DeviceForm = { name: 'SW', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: 'r1', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'ACTIVE', isCritical: false, frontAssetId: '', backAssetId: '' };
const ctx = (overrides: Partial<Parameters<typeof evaluateDeviceRequirements>[2]> = {}) => ({ model: null as DeviceModel | null, siteId: 's1', defaultPlugCount: 2, isNew: true, sendsPower: true, ...overrides });
const keys = (states: ReturnType<typeof evaluateDeviceRequirements>) => states.map((item) => `${item.config.key}:${item.blocking ? 'block' : 'hint'}`);

describe('device requirements (registry-driven)', () => {
  it('evaluates only the configs the registry lists', () => {
    expect(keys(evaluateDeviceRequirements(registryFixture, { ...form, name: ' ' }, ctx(), { isNew: true }))).toEqual(['name:block', 'rearImage:block']);
    const withoutRear = { ...registryFixture, configs: registryFixture.configs.filter((item) => item.key !== 'rearImage') };
    expect(keys(evaluateDeviceRequirements(withoutRear, form, ctx(), { isNew: true }))).toEqual([]);
    expect(evaluateDeviceRequirements(null, { ...form, name: '' }, ctx(), { isNew: true })).toEqual([]);
  });

  it('rear image applies in a rack and not when retired; the model image counts', () => {
    expect(keys(evaluateDeviceRequirements(registryFixture, { ...form, rackId: '' }, ctx(), { isNew: true }))).toEqual([]);
    expect(keys(evaluateDeviceRequirements(registryFixture, { ...form, status: 'RETIRED' }, ctx(), { isNew: true }))).toEqual([]);
    expect(keys(evaluateDeviceRequirements(registryFixture, form, ctx({ model: { id: 'm', manufacturer: 'A', model: 'B', backAssetId: 'x' } }), { isNew: true }))).toEqual([]);
  });

  it('placement needs a rack or the Site', () => {
    expect(keys(evaluateDeviceRequirements(registryFixture, { ...form, rackId: '' }, ctx({ siteId: null }), { isNew: true }))).toEqual(['placement:block']);
  });

  it('existing device: legacy gaps are hints, clearing a satisfied feature config blocks', () => {
    const legacy = { ...form, savedRackId: 'r1', requiredMissing: ['rearImage', 'power'] };
    const context = ctx({ isNew: false, sendsPower: false });
    const atOpen = satisfiedFeatureConfigs(registryFixture, legacy, context);
    expect(keys(evaluateDeviceRequirements(registryFixture, legacy, context, { isNew: false, satisfiedAtOpen: atOpen }))).toEqual(['rearImage:hint', 'power:hint']);

    const complete = { ...form, backAssetId: 'rear', savedRackId: 'r1', requiredMissing: [] };
    const completeAtOpen = satisfiedFeatureConfigs(registryFixture, complete, context);
    expect([...completeAtOpen]).toEqual(['rearImage', 'power']);
    expect(keys(evaluateDeviceRequirements(registryFixture, { ...complete, backAssetId: '' }, context, { isNew: false, satisfiedAtOpen: completeAtOpen }))).toEqual(['rearImage:block']);
  });

  it('sends power when a device with plugs lands in a rack (new or moved), not otherwise', () => {
    const base = { model: null, siteId: 's1', defaultPlugCount: 2 };
    expect(saveSendsPower(form, { ...base, isNew: true })).toBe(true);
    expect(saveSendsPower({ ...form, powerPlugCount: '0' }, { ...base, isNew: true })).toBe(false);
    expect(saveSendsPower({ ...form, rackId: '' }, { ...base, isNew: true })).toBe(false);
    expect(saveSendsPower({ ...form, status: 'RETIRED' }, { ...base, isNew: true })).toBe(false);
    expect(saveSendsPower(form, { ...base, model: { id: 'm', manufacturer: 'A', model: 'B', powerPlugCount: 0 }, isNew: true })).toBe(false);
    expect(saveSendsPower({ ...form, savedRackId: 'r1' }, { ...base, isNew: false })).toBe(false);
    expect(saveSendsPower({ ...form, savedRackId: 'r0' }, { ...base, isNew: false })).toBe(true);
    expect(saveSendsPower({ ...form, savedRackId: '' }, { ...base, isNew: false })).toBe(true);
  });
});

describe('API 400 mapping', () => {
  it('maps REQUIRED_CONFIG_MISSING errors (MISSING, CLEARED, NO_FREE_OUTLET) onto fields and tabs', () => {
    expect(mapApiFieldErrors({
      code: 'REQUIRED_CONFIG_MISSING', message: 'Faltam 3 configurações obrigatórias.',
      details: { errors: [
        { config: 'rearImage', tab: 'imagens', fields: ['backAssetId'], reason: 'CLEARED', message: 'Sem imagem traseira.' },
        { config: 'power', tab: 'energia', fields: ['power', 'powerPlugCount'], reason: 'NO_FREE_OUTLET', message: 'Não há tomadas livres na PDU.' },
        { config: 'placement', tab: 'localizacao', fields: ['siteId', 'rackId'], reason: 'MISSING', message: 'Seleciona um Site ou bastidor.' },
        { config: 'future', tab: 'energia', fields: ['somethingNew'], reason: 'MISSING', message: 'Duplicado no mesmo campo.' },
        { config: 'other', tab: 'nowhere', fields: ['x'], reason: 'MISSING', message: 'Sem destino.' },
      ] },
    } as never)).toEqual([
      { fieldId: 'device-rear-image', tab: 'imagens', message: 'Sem imagem traseira.' },
      { fieldId: 'device-power-plugs', tab: 'energia', message: 'Não há tomadas livres na PDU.' },
      { fieldId: 'device-rack', tab: 'localizacao', message: 'Seleciona um Site ou bastidor.' },
    ]);
  });

  it('maps VALIDATION_ERROR plain messages by their property', () => {
    expect(mapApiFieldErrors({ code: 'VALIDATION_ERROR', message: 'x', details: { errors: ['name must be longer than or equal to 1 characters', 'estimatedWatts must not be greater than 20000', 'unknownProp should not exist'] } } as never)).toEqual([
      { fieldId: 'device-name', tab: 'geral', message: 'name must be longer than or equal to 1 characters' },
      { fieldId: 'device-power-watts', tab: 'energia', message: 'estimatedWatts must not be greater than 20000' },
    ]);
    expect(mapApiFieldErrors(undefined)).toEqual([]);
    expect(mapApiFieldErrors({ code: 'X', message: 'y' } as never)).toEqual([]);
  });
});

describe('deep links', () => {
  it('builds and reads the API href contract', () => {
    expect(deviceSettingsHref('d1', 'energia', 's1')).toBe('/infraestrutura?siteId=s1&tab=devices&deviceId=d1&settingsTab=energia');
    expect(settingsTabFromSearch('?tab=devices&deviceId=d1&settingsTab=imagens')).toBe('imagens');
    expect(settingsTabFromSearch('?settingsTab=nope')).toBeUndefined();
    expect(missingConfigFromSearch('?tab=devices&missingConfig=rearImage')).toBe('rearImage');
    expect(missingConfigFromSearch('?missingConfig=%3Cscript%3E')).toBe('');
  });
});

describe('effectiveStatus (mirrors the API status override)', () => {
  const base: DeviceForm = { name: 'SW', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: 'rack-1', rackUnitStart: '1', rackUnitSize: '1', modelId: '', status: 'RETIRED', isCritical: false, frontAssetId: '', backAssetId: '' };
  it('racking an ACTIVE/UNKNOWN device stores ACTIVE even when RETIRED is picked', () => {
    expect(effectiveStatus(base, { isNew: false, opened: { ...base, rackId: '', status: 'UNKNOWN' } })).toBe('ACTIVE');
    expect(effectiveStatus({ ...base, status: 'MAINTENANCE' }, { isNew: false, opened: { ...base, status: 'ACTIVE' } })).toBe('ACTIVE');
  });
  it('keeps the chosen status for a RETIRED device, a new RETIRED device, or no rack', () => {
    expect(effectiveStatus({ ...base, status: 'INACTIVE' }, { isNew: false, opened: { ...base, status: 'RETIRED' } })).toBe('INACTIVE');
    expect(effectiveStatus(base, { isNew: true })).toBe('RETIRED');
    expect(effectiveStatus({ ...base, status: 'UNKNOWN' }, { isNew: true })).toBe('ACTIVE');
    expect(effectiveStatus({ ...base, rackId: '' }, { isNew: false, opened: { ...base, status: 'ACTIVE' } })).toBe('RETIRED');
  });
  it('a missingConfig link without siteId, or with allSites=1, is cross-site', () => {
    expect(missingConfigAllSitesFromSearch('?tab=devices&missingConfig=power&allSites=1')).toBe(true);
    expect(missingConfigAllSitesFromSearch('?tab=devices&missingConfig=power')).toBe(true);
    expect(missingConfigAllSitesFromSearch('?siteId=lx&tab=devices&missingConfig=power')).toBe(false);
    expect(missingConfigAllSitesFromSearch('?tab=devices')).toBe(false);
  });
});
