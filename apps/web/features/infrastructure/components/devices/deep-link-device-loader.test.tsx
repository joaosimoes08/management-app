import { useState } from 'react';
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
});
