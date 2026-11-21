import type { ImpactDevice, TopologyImpact, TopologyPath } from '../impact-api';

const device = (id: string, name: string, extra: Partial<ImpactDevice> = {}): ImpactDevice => ({ id, name, type: 'SWITCH', status: 'ACTIVE', hostname: null, managementIp: null, isCritical: false, criticalityTier: null, rackId: null, ...extra });

/** Core switch goes down: two access switches are cut off, a dual-fed server loses one feed. */
export function impactFixture(extra: Partial<TopologyImpact> = {}): TopologyImpact {
  return {
    origin: { kind: 'DEVICE', id: 'core', name: 'Core-SW-01' }, siteId: 'site-1', maxDepth: 12, includeLogical: false, truncated: false,
    anchorMode: 'gateway-devices', anchorDeviceIds: ['fw'],
    down: [{ ...device('core', 'Core-SW-01'), reason: 'ORIGIN' }],
    affected: [
      { ...device('acc-1', 'Access-SW-07', { criticalityTier: 'T1', isCritical: true }), hops: 1, viaDeviceId: 'core', viaConnectionId: 'c-core-acc1' },
      { ...device('acc-2', 'Access-SW-08'), hops: 2, viaDeviceId: 'acc-1', viaConnectionId: 'c-acc1-acc2' },
    ],
    powerDegraded: [device('srv', 'Server-01', { type: 'SERVER' })],
    hosts: [{ id: 'h1', name: 'app-host', hostname: 'app-host.local', status: 'ACTIVE', deviceId: 'acc-2', services: [{ id: 's1', name: 'https', port: 443 }] }],
    applications: [{ id: 'a1', name: 'Intranet', url: 'https://app-host.local', category: null, matchedHost: 'app-host.local' }],
    critical: { T1: ['acc-1'], T2: [], T3: [], untiered: [] },
    counts: { down: 1, affected: 2, powerDegraded: 1, hosts: 1, services: 1, applications: 1, tier1: 1 },
    hiddenCount: 0, elapsedMs: 12,
    ...extra,
  };
}

export function pathFixture(): TopologyPath {
  return {
    found: true, hops: 2, maxDepth: 12, includeLogical: false,
    steps: [{ hidden: false, ...device('acc-2', 'Access-SW-08') }, { hidden: true, id: null }, { hidden: false, ...device('fw', 'FW-01', { type: 'FIREWALL' }) }],
    connections: [
      { hidden: true, id: null },
      { hidden: false, id: 'c-x-fw', type: 'PHYSICAL', label: 'uplink', sourceDeviceId: 'fw', targetDeviceId: 'x', sourceInterface: { id: 'i1', name: 'port1' }, targetInterface: { id: 'i2', name: 'ge-0/0/1' } },
    ],
  };
}
