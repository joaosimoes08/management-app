import type { DeviceInterface } from '@/features/infrastructure/types';

export function availableInterfaces(interfaces: DeviceInterface[], usedInterfaceIds: ReadonlySet<string>) {
  return interfaces.filter((item) => !usedInterfaceIds.has(item.id));
}

export function retainAvailableInterfaceId(id: string, usedInterfaceIds: ReadonlySet<string>) {
  return id && !usedInterfaceIds.has(id) ? id : '';
}
