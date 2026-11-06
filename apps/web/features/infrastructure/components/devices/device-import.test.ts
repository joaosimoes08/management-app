import { describe, expect, it } from 'vitest';
import { detectDeviceImportMapping, deviceImportFields, mapDeviceImportRows, parseDeviceCsv } from './device-import';

describe('device CSV import mapping', () => {
  it('maps rack ID and required rack-unit positions through to preview rows', () => {
    const values = parseDeviceCsv('name,type,rackId,rackUnitStart,rackUnitSize\nedge-1,SWITCH,rack-a,7,2');
    const mapping = detectDeviceImportMapping(values[0]);
    const rows = mapDeviceImportRows(values, mapping, []);

    expect(deviceImportFields).toContain('rackUnitStart');
    expect(deviceImportFields).toContain('rackUnitSize');
    expect(rows).toEqual([{ name: 'edge-1', type: 'SWITCH', rackId: 'rack-a', rackUnitStart: '7', rackUnitSize: '2' }]);
  });
});
