import { describe, expect, it } from 'vitest';
import { summarizeTopologyDeviceAlerts } from './alerts';
import type { TopologyNode } from './types';
import type { OperationalAlert } from '@/features/operations/api';

const nodes: TopologyNode[] = [
  { id: 'map:device-a', deviceId: 'device-a', x: 0, y: 0 },
  { id: 'map:device-b', deviceId: 'device-b', x: 0, y: 0 },
];

const alert = (id: string, entityId: string, severity: OperationalAlert['severity'], status: OperationalAlert['status'] = 'OPEN'): OperationalAlert => ({ id, title: id, entityType: 'Device', entityId, severity, status });

describe('summarizeTopologyDeviceAlerts', () => {
  it('groups unresolved device alerts by map node and picks the highest severity', () => {
    const result = summarizeTopologyDeviceAlerts(nodes, [
      alert('warning', 'device-a', 'WARNING'),
      alert('critical', 'device-a', 'CRITICAL', 'ACKNOWLEDGED'),
      alert('other-device', 'device-c', 'HIGH'),
      { ...alert('not-a-device', 'device-a', 'HIGH'), entityType: 'DiscoveryJob' },
    ]);

    expect(result.get('device-a')).toEqual({ count: 2, highestSeverity: 'CRITICAL', titles: ['warning', 'critical'] });
    expect(result.has('device-b')).toBe(false);
    expect(result.has('device-c')).toBe(false);
  });

  it('ignores resolved alerts', () => {
    expect(summarizeTopologyDeviceAlerts(nodes, [alert('resolved', 'device-a', 'CRITICAL', 'RESOLVED')])).toEqual(new Map());
  });
});
