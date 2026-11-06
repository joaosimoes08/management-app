import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch }));

import { createTopologyConnection, getTopologyConnectionPortAvailability } from './api';

describe('createTopologyConnection', () => {
  beforeEach(() => apiFetch.mockReset());

  it('sends device IDs and only fields accepted by the connection API', () => {
    createTopologyConnection('map-1', {
      sourceNodeId: 'map-1:device-a',
      targetNodeId: 'map-1:device-b',
      revision: 3,
      sourceInterfaceId: 'port-a',
      targetInterfaceId: 'port-b',
      type: 'PHYSICAL',
      label: 'Uplink',
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/v1/topology/maps/map-1/connections', {
      method: 'POST',
      body: JSON.stringify({ revision: 3, sourceInterfaceId: 'port-a', targetInterfaceId: 'port-b', type: 'PHYSICAL', label: 'Uplink', sourceDeviceId: 'device-a', targetDeviceId: 'device-b' }),
    });
  });
});

describe('getTopologyConnectionPortAvailability', () => {
  beforeEach(() => apiFetch.mockReset());

  it('requests map-scoped port usage and excludes the connection being edited', () => {
    getTopologyConnectionPortAvailability('map-1', 'connection-1');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/topology/maps/map-1/connection-port-availability?excludeConnectionId=connection-1');
  });
});
