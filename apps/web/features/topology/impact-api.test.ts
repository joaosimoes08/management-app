import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch }));

import { getTopologyImpact, getTopologyPath, impactParam, parseImpactParam, topologyImpactHref } from './impact-api';

const ID = '0b0c6a1e-1f2a-4c3d-8e9f-0a1b2c3d4e5f';

describe('topology impact client', () => {
  beforeEach(() => apiFetch.mockReset());

  it('names exactly one of deviceId, pduId or rackId', () => {
    getTopologyImpact({ kind: 'DEVICE', id: ID });
    getTopologyImpact({ kind: 'PDU', id: ID }, { includeLogical: true });
    getTopologyImpact({ kind: 'RACK', id: ID });
    expect(apiFetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/topology/impact?deviceId=${ID}`,
      `/api/v1/topology/impact?pduId=${ID}&includeLogical=true`,
      `/api/v1/topology/impact?rackId=${ID}`,
    ]);
  });

  it('asks for the path between two devices', () => {
    getTopologyPath('a', 'b');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/topology/path?fromDeviceId=a&toDeviceId=b');
  });

  it('round-trips the Topologia impact parameter and rejects anything else', () => {
    expect(parseImpactParam(impactParam({ kind: 'PDU', id: ID }))).toEqual({ kind: 'PDU', id: ID });
    expect(parseImpactParam('host:abc')).toBeNull();
    expect(parseImpactParam(null)).toBeNull();
    expect(topologyImpactHref({ kind: 'DEVICE', id: ID }, 'site-1')).toBe(`/topology?siteId=site-1&impact=device%3A${ID}`);
  });
});
