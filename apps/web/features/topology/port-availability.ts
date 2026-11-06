import type { DeviceInterface } from '@/features/infrastructure/types';
import type { TopologyConnection } from './types';

export function availableTopologyPorts(
  deviceId: string,
  interfacesByDevice: Record<string, DeviceInterface[]>,
  connections: TopologyConnection[],
  exceptConnectionId?: string,
) {
  const inUse = new Set<string>();
  for (const connection of connections) {
    if (connection.id === exceptConnectionId) continue;
    if (connection.sourceInterfaceId) inUse.add(connection.sourceInterfaceId);
    if (connection.targetInterfaceId) inUse.add(connection.targetInterfaceId);
  }
  return (interfacesByDevice[deviceId] ?? []).filter((port) => !inUse.has(port.id));
}
