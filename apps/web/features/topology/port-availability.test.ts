import { describe, expect, it } from 'vitest';
import { availableTopologyPorts } from './port-availability';
import type { DeviceInterface } from '@/features/infrastructure/types';
import type { TopologyConnection } from './types';

const ports = [
  { id: 'port-a', deviceId: 'device-a', name: 'eth0' },
  { id: 'port-b', deviceId: 'device-a', name: 'eth1' },
  { id: 'port-c', deviceId: 'device-a', name: 'eth2' },
] as DeviceInterface[];

const connections = [
  { id: 'connection-1', sourceInterfaceId: 'port-a', targetInterfaceId: 'port-x' },
  { id: 'connection-2', sourceInterfaceId: 'port-y', targetInterfaceId: 'port-b' },
] as TopologyConnection[];

describe('availableTopologyPorts', () => {
  it('filters ports used at either end of any connection', () => {
    expect(availableTopologyPorts('device-a', { 'device-a': ports }, connections).map((port) => port.id)).toEqual(['port-c']);
  });

  it('keeps the selected connection port available while editing that connection', () => {
    expect(availableTopologyPorts('device-a', { 'device-a': ports }, connections, 'connection-1').map((port) => port.id)).toEqual(['port-a', 'port-c']);
  });
});
