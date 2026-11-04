import { describe, expect, it } from 'vitest';
import { loadAllTopologyAlerts, summarizeTopologyDeviceAlerts, topologyDeviceImage, topologySeverityColor } from './alerts';
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

  it('associates SNMP-origin alerts with the represented device', () => {
    const result = summarizeTopologyDeviceAlerts(nodes, [
      { ...alert('poll-failed', 'job-1', 'WARNING'), entityType: 'SnmpJob', relatedDeviceId: 'device-a' },
      { ...alert('trap', 'trap-1', 'HIGH'), entityType: 'SnmpTrapEvent', relatedDeviceId: 'device-a' },
      { ...alert('unassociated-trap', 'trap-2', 'CRITICAL'), entityType: 'SnmpTrapEvent', relatedDeviceId: null },
    ]);
    expect(result.get('device-a')).toEqual({ count: 2, highestSeverity: 'HIGH', titles: ['poll-failed', 'trap'] });
    expect(result.size).toBe(1);
  });
});

describe('loadAllTopologyAlerts', () => {
  it('loads all pages when the site has more than one hundred active alerts', async () => {
    const requested: number[] = [];
    const fetchPage = async (page: number) => {
      requested.push(page);
      return { items: Array.from({ length: page === 3 ? 5 : 100 }, (_, index) => ({ id: `${page}-${index}` } as OperationalAlert)), total: 205, page, pageSize: 100 };
    };
    const result = await loadAllTopologyAlerts(fetchPage);
    expect(requested).toEqual([1, 2, 3]);
    expect(result).toHaveLength(205);
  });
});

describe('topologySeverityColor', () => {
  it('uses a visible, stable color for each alert severity', () => {
    expect(topologySeverityColor('CRITICAL')).toBe('#b91c1c');
    expect(topologySeverityColor('HIGH')).toBe('#ea580c');
    expect(topologySeverityColor('WARNING')).toBe('#a16207');
    expect(topologySeverityColor('LOW')).toBe('#1d4ed8');
  });
});

describe('topologyDeviceImage', () => {
  it('prefers the configured device image and falls back to its model image', () => {
    const deviceImage = { id: 'device-image', filename: 'device.png', mimeType: 'image/png' } as NonNullable<TopologyNode['device']>['frontAsset'];
    const modelImage = { id: 'model-image', filename: 'model.png', mimeType: 'image/png' } as NonNullable<TopologyNode['device']>['frontAsset'];
    expect(topologyDeviceImage({ frontAsset: deviceImage, model: { frontAsset: modelImage } })).toBe(deviceImage);
    expect(topologyDeviceImage({ model: { frontAsset: modelImage } })).toBe(modelImage);
  });
});
