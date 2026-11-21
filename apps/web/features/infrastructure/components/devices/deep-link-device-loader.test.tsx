import { StrictMode, useState } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../../types';
import { DeepLinkDeviceLoader } from './deep-link-device-loader';

afterEach(cleanup);

describe('DeepLinkDeviceLoader', () => {
  it('loads and selects the exact device directly without a Site context', async () => {
    const target = { id: 'unassigned-device', name: 'switch-lab', siteId: null } as Device;
    const loadDevice = vi.fn(async (id: string) => ({ ...target, id }));
    const onOpen = vi.fn();
    const onError = vi.fn();
    function NoSiteHarness() {
      const [selected, setSelected] = useState<Device | null>(null);
      return <><DeepLinkDeviceLoader deviceId="unassigned-device" loadDevice={loadDevice} onOpen={(device) => { onOpen(device); setSelected(device); }} onError={onError} />{selected && <div role="dialog">{selected.id}</div>}</>;
    }

    const { findByRole } = render(<NoSiteHarness />);

    expect(await findByRole('dialog')).toHaveTextContent('unassigned-device');
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(target));
    expect(loadDevice).toHaveBeenCalledWith('unassigned-device');
    expect(onError).not.toHaveBeenCalled();
  });

  it('still opens under StrictMode (mount, unmount, mount) with a slow load', async () => {
    let resolve!: (device: Device) => void;
    const loadDevice = vi.fn(() => new Promise<Device>((done) => { resolve = done; }));
    const onOpen = vi.fn();
    render(<StrictMode><DeepLinkDeviceLoader deviceId="dev-9" loadDevice={loadDevice} onOpen={onOpen} onError={vi.fn()} /></StrictMode>);
    resolve({ id: 'dev-9', name: 'UCS01' } as Device);
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'dev-9' }));
  });

  it('a new onOpen identity while the load is in flight does not cancel it, and the device opens once', async () => {
    let resolve!: (device: Device) => void;
    const loadDevice = vi.fn(() => new Promise<Device>((done) => { resolve = done; }));
    const opened: string[] = [];
    const { rerender } = render(<DeepLinkDeviceLoader deviceId="dev-9" loadDevice={loadDevice} onOpen={(device) => opened.push(`first:${device.id}`)} onError={vi.fn()} />);
    rerender(<DeepLinkDeviceLoader deviceId="dev-9" loadDevice={loadDevice} onOpen={(device) => opened.push(`second:${device.id}`)} onError={vi.fn()} />);
    resolve({ id: 'dev-9', name: 'UCS01' } as Device);
    await waitFor(() => expect(opened).toEqual(['second:dev-9']));
    expect(loadDevice).toHaveBeenCalledTimes(1);
  });
});
