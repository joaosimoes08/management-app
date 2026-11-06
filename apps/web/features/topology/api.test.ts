import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch }));

import { createTopologyConnection } from './api';

describe('createTopologyConnection', () => {
  beforeEach(() => apiFetch.mockReset());

  it('sends device IDs and only fields accepted by the connection API', () => {
    createTopologyConnection('map-1', {
      sourceNodeId: 'map-1:device-a',
      targetNodeId: 'map-1:device-b',
      revision: 3,
      sourceInterfaceId: 'interface-a',
      targetInterfaceId: 'interface-b',
      type: 'PHYSICAL',
      label: 'Uplink',
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/topology/maps/map-1/connections', {
      method: 'POST',
      body: JSON.stringify({ revision: 3, sourceInterfaceId: 'interface-a', targetInterfaceId: 'interface-b', type: 'PHYSICAL', label: 'Uplink', sourceDeviceId: 'device-a', targetDeviceId: 'device-b' }),
    });
  });
});
