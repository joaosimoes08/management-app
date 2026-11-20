import { describe, expect, it } from 'vitest';
import { deviceSettingsHref, deviceTabFromSearch, evaluateDeviceRequirements, mapApiFieldErrors, missingRequirementKeys, tabForMissingKeys } from './device-requirements';
import type { DeviceForm } from './forms';

const form: DeviceForm = { name: 'SW', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: 'r', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'ACTIVE', isCritical: false, frontAssetId: '', backAssetId: '' };

describe('device requirements', () => {
  it('blocks every gap on a new device, only regressions on an existing one', () => {
    expect(evaluateDeviceRequirements(form, null, { isNew: true }).map((item) => [item.requirement.key, item.blocking])).toEqual([['rearImage', true], ['powerPlugCount', true], ['estimatedWatts', true]]);
    const atOpen = missingRequirementKeys(form, null);
    expect(evaluateDeviceRequirements(form, null, { isNew: false, missingAtOpen: atOpen }).every((item) => !item.blocking)).toBe(true);
    expect(evaluateDeviceRequirements({ ...form, name: ' ' }, null, { isNew: false, missingAtOpen: atOpen }).find((item) => item.requirement.key === 'name')?.blocking).toBe(true);
    expect(evaluateDeviceRequirements(form, null, { isNew: false, missingAtOpen: new Set() }).every((item) => item.blocking)).toBe(true);
  });

  it('the rear image only applies to a device in a rack', () => {
    expect(evaluateDeviceRequirements({ ...form, rackId: '' }, null, { isNew: true }).some((item) => item.requirement.key === 'rearImage')).toBe(false);
  });

  it('maps API 400 field errors in the shapes the API may send', () => {
    expect(mapApiFieldErrors({ code: 'VALIDATION_ERROR', fields: [{ field: 'backAssetId', message: 'Imagem traseira obrigatória.' }] } as never)).toEqual([{ fieldId: 'device-rear-image', tab: 'imagens', message: 'Imagem traseira obrigatória.' }]);
    expect(mapApiFieldErrors({ details: { fields: { powerPlugCount: ['Obrigatório.'] } } } as never)).toEqual([{ fieldId: 'device-power-plugs', tab: 'energia', message: 'Obrigatório.' }]);
    expect(mapApiFieldErrors({ errors: [{ property: 'estimatedWatts', constraints: { min: 'Mínimo 0.' } }, { property: 'unknown', message: 'x' }] } as never)).toEqual([{ fieldId: 'device-power-watts', tab: 'energia', message: 'Mínimo 0.' }]);
    expect(mapApiFieldErrors({ fields: [{ field: 'name' }] } as never)[0].message).toBe('O nome é obrigatório.');
    expect(mapApiFieldErrors(undefined)).toEqual([]);
  });

  it('builds and reads the device settings deep link', () => {
    expect(deviceSettingsHref('d 1', 'energia', 's1')).toBe('/infraestrutura?siteId=s1&focus=device&deviceId=d+1&deviceTab=energia');
    expect(deviceTabFromSearch('?focus=device&deviceId=d&deviceTab=imagens')).toBe('imagens');
    expect(deviceTabFromSearch('?deviceTab=nope')).toBeUndefined();
    expect(tabForMissingKeys(['REAR_IMAGE'])).toBe('imagens');
    expect(tabForMissingKeys(['powerPlugCount', 'rearImage'])).toBe('energia');
    expect(tabForMissingKeys(['POWER_OUTLETS'])).toBe('energia');
  });
});
