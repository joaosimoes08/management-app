import { afterEach, describe, expect, it } from 'vitest';
import type { AssetFile, Device, DeviceModel } from './types';
import { RACK_VIEW_STORAGE_KEY, allPortLayoutPorts, expectedPortCount, isPortFullyMapped, deviceFaceImage, normalizePortLayout, normalizedPortLayoutPorts, portMappingStatus, primaryPortFace, readRackView, writeRackView } from './utils';

const asset = (id: string): AssetFile => ({ id, filename: `${id}.png`, mimeType: 'image/png' } as AssetFile);
const port = (portKey: string) => ({ portKey, label: portKey, x: 0, y: 0, width: 10, height: 10 });

afterEach(() => sessionStorage.clear());

describe('normalizePortLayout', () => {
  it('treats a v1 layout as the rear face', () => {
    const faces = normalizePortLayout({ imageWidth: 100, imageHeight: 20, ports: [port('p1')] });
    expect(faces.front).toBeUndefined();
    expect(faces.rear?.ports).toHaveLength(1);
  });

  it('keeps both faces of a v2 layout and lists front ports first', () => {
    const layout = { version: 2 as const, faces: { front: { imageWidth: 100, imageHeight: 20, ports: [port('f1')] }, rear: { imageWidth: 100, imageHeight: 20, ports: [port('r1'), port('r2')] } } };
    expect(normalizePortLayout(layout).rear?.ports).toHaveLength(2);
    expect(allPortLayoutPorts(layout).map((entry) => entry.portKey)).toEqual(['f1', 'r1', 'r2']);
  });

  it('returns no faces for a missing or numeric layout', () => {
    expect(normalizePortLayout(null)).toEqual({});
    expect(normalizePortLayout(24)).toEqual({});
  });
});

describe('port mapping status and face choice', () => {
  const model = (portLayout: DeviceModel['portLayout'], networkPortCount = 3) => ({ id: 'm', manufacturer: 'X', model: 'Y', networkPortCount, portLayout } as DeviceModel);

  it('counts ports on both faces against the model port count', () => {
    const split = model({ version: 2, faces: { front: { imageWidth: 1, imageHeight: 1, ports: [port('a')] }, rear: { imageWidth: 1, imageHeight: 1, ports: [port('b'), port('c')] } } });
    expect(portMappingStatus(split)).toEqual({ expected: 3, mapped: 3, complete: true });
    expect(portMappingStatus(model({ version: 2, faces: { rear: { imageWidth: 1, imageHeight: 1, ports: [port('b')] } } }))).toMatchObject({ mapped: 1, complete: false });
  });

  it('uses the API expected-count rule', () => {
    const base = { id: 'm', manufacturer: 'X', model: 'Y', portLayout: null } as DeviceModel;
    expect(expectedPortCount({ ...base, networkPortCount: 4, portCount: 8 })).toBe(4);
    expect(expectedPortCount({ ...base, networkPortCount: null, portCount: 8 })).toBe(8);
    expect(expectedPortCount({ ...base, networkPortCount: 0, portCount: 8 })).toBe(0);
    expect(expectedPortCount({ ...base, supportsNetworkPorts: false, networkPortCount: 4 })).toBe(0);
    expect(expectedPortCount({ ...base })).toBe(0);
    expect(portMappingStatus({ ...base, networkPortCount: 0 })).toEqual({ expected: 0, mapped: 0, complete: true });
  });

  it('counts only fully mapped ports', () => {
    const half = [{ portKey: 'a', label: 'a', x: 0, y: 0, width: 0, height: 10 }, { portKey: '', label: 'b', x: 0, y: 0, width: 10, height: 10 }, port('c')];
    expect(portMappingStatus(model({ version: 2, faces: { rear: { imageWidth: 1, imageHeight: 1, ports: half } } }))).toMatchObject({ expected: 3, mapped: 1, complete: false });
    expect(isPortFullyMapped(port('x'))).toBe(true);
    expect(isPortFullyMapped({ portKey: 'x', x: Number.NaN, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it('opens on the face that has ports when the preferred face has none', () => {
    const rearOnly = model({ version: 2, faces: { rear: { imageWidth: 1, imageHeight: 1, ports: [port('b')] } } });
    expect(primaryPortFace(rearOnly, 'front')).toBe('rear');
    expect(primaryPortFace(rearOnly, 'rear')).toBe('rear');
  });

  it('shows hotspots only on the mapped face', () => {
    const device = { model: model({ version: 2, faces: { rear: { imageWidth: 1, imageHeight: 1, ports: [port('b')] } } }) } as Device;
    expect(normalizedPortLayoutPorts(device, 'rear')).toHaveLength(1);
    expect(normalizedPortLayoutPorts(device, 'front')).toEqual([]);
  });
});

describe('deviceFaceImage fallback', () => {
  it('uses the device image, then the model image, per face', () => {
    const device = { frontAsset: asset('dev-front'), backAsset: null, model: { frontAsset: asset('model-front'), backAsset: asset('model-rear') } } as unknown as Device;
    expect(deviceFaceImage(device, 'front')?.id).toBe('dev-front');
    expect(deviceFaceImage(device, 'rear')?.id).toBe('model-rear');
  });

  it('returns null when neither has an image for the face', () => {
    const device = { frontAsset: null, model: { frontAsset: asset('model-front') } } as unknown as Device;
    expect(deviceFaceImage(device, 'rear')).toBeNull();
  });
});

describe('rack view memory', () => {
  it('defaults to both faces from 1280px and to the front below', () => {
    expect(readRackView(1920)).toBe('both');
    expect(readRackView(1280)).toBe('both');
    expect(readRackView(1279)).toBe('front');
  });

  it('remembers the choice for the session, falling back from both on narrow screens', () => {
    writeRackView('rear');
    expect(sessionStorage.getItem(RACK_VIEW_STORAGE_KEY)).toBe('rear');
    expect(readRackView(1920)).toBe('rear');
    writeRackView('both');
    expect(readRackView(390)).toBe('front');
  });
});
