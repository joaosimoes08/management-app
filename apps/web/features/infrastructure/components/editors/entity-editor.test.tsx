import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceImageFields, type DeviceForm, type ModelForm, type RackForm } from '../../forms';
import type { AssetFile } from '../../types';
import { EntityEditor } from './entity-editor';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
afterEach(cleanup);

const assets = [
  { id: 'front-1', filename: 'front-1.png', mimeType: 'image/png' },
  { id: 'rear-1', filename: 'rear-1.png', mimeType: 'image/png' },
  { id: 'rear-2', filename: 'rear-2.png', mimeType: 'image/png' },
] as AssetFile[];

// Form as editDevice builds it for a device that has both image overrides.
const opened: DeviceForm = {
  name: 'SW-1', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'ACTIVE', isCritical: false,
  frontAssetId: 'front-1', backAssetId: 'rear-1', savedAssetIds: { front: 'front-1', rear: 'rear-1' },
};

function Harness({ save, editingId = 'dev-1', initial = opened }: { save: (path: string, body: Record<string, unknown>) => Promise<void>; editingId?: string; initial?: DeviceForm }) {
  const [device, setDevice] = useState(initial);
  const [rack, setRack] = useState<RackForm>({ name: '', units: '42', roomId: '', modelId: '', frontAssetId: '' });
  const [model, setModel] = useState<ModelForm>({ manufacturer: '', model: '', type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: '', frontAssetId: '', backAssetId: '' });
  return <EntityEditor modal="device" close={() => {}} editingId={editingId} form={{ rack, device, model }} setForm={{ rack: setRack, device: setDevice, model: setModel }} rooms={[]} racks={[]} models={[]} assets={assets} ips={[]} save={save} />;
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
const rearPicker = () => screen.getByLabelText(/Imagem traseira/) as HTMLSelectElement;

describe('device edit image overrides', () => {
  it('saving an unchanged device keeps both overrides', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness save={save} />);
    expect(rearPicker().value).toBe('rear-1');
    submit();
    const [path, body] = save.mock.calls[0];
    expect(path).toBe('/api/v1/devices/dev-1');
    // Absent fields are left alone by the API, so both images survive the round trip.
    expect(body).not.toHaveProperty('frontAssetId');
    expect(body).not.toHaveProperty('backAssetId');
    expect(body).not.toHaveProperty('savedAssetIds');
  });

  it('sends null only when the user picks the model image', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness save={save} />);
    fireEvent.change(rearPicker(), { target: { value: '' } });
    submit();
    expect(save.mock.calls[0][1]).toMatchObject({ backAssetId: null });
    expect(save.mock.calls[0][1]).not.toHaveProperty('frontAssetId');
  });

  it('sends a changed override', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<Harness save={save} />);
    fireEvent.change(rearPicker(), { target: { value: 'rear-2' } });
    submit();
    expect(save.mock.calls[0][1]).toMatchObject({ backAssetId: 'rear-2' });
  });
});

describe('deviceImageFields', () => {
  it('sends only chosen images for a new device', () => {
    expect(deviceImageFields({ frontAssetId: 'f', backAssetId: '' })).toEqual({ frontAssetId: 'f' });
    expect(deviceImageFields({ frontAssetId: '', backAssetId: undefined })).toEqual({});
  });
});
