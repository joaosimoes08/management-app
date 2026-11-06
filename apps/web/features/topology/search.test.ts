import { describe, expect, it } from 'vitest';
import { findTopologyNode } from './search';
import type { TopologyNode } from './types';

const nodes: TopologyNode[] = [
  { id: 'map:1', deviceId: '1', x: 0, y: 0, label: 'Core gateway', device: { id: '1', name: 'GW-01', type: 'ROUTER', managementIp: '10.0.0.1' } },
  { id: 'map:2', deviceId: '2', x: 0, y: 0, device: { id: '2', name: 'SW-02', type: 'SWITCH', managementIp: '10.0.0.2' } },
];

describe('findTopologyNode', () => {
  it('matches labels, names, addresses and device types without case sensitivity', () => {
    expect(findTopologyNode(nodes, ' CORE ' )?.id).toBe('map:1');
    expect(findTopologyNode(nodes, 'gw-01')?.id).toBe('map:1');
    expect(findTopologyNode(nodes, '10.0.0.2')?.id).toBe('map:2');
    expect(findTopologyNode(nodes, 'switch')?.id).toBe('map:2');
  });

  it('returns no match for an empty or unknown query', () => {
    expect(findTopologyNode(nodes, '  ')).toBeUndefined();
    expect(findTopologyNode(nodes, 'missing')).toBeUndefined();
  });
});
