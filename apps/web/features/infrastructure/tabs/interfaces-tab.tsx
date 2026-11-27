'use client';

import { generateInterfaces as apiGenerateInterfaces } from '../api';
import { InterfaceWorkspace } from '../components/models/interface-workspace';
import type { DeviceInterface } from '../types';
import { useInfrastructureWorkspace } from '../workspace-context';
import { matchesSearch } from './search';

type InterfacesTabProps = {
  interfaces: DeviceInterface[];
  selectedInterface: DeviceInterface | null;
  onInterface: (item: DeviceInterface) => void;
};

/** Interfaces: the open device's interfaces, filtered by the search box. */
export function InterfacesTab({ interfaces, selectedInterface, onInterface }: InterfacesTabProps) {
  const { navigation, devices, device, openDevice, editDevice } = useInfrastructureWorkspace();
  const visibleInterfaces = interfaces.filter((item) => matchesSearch(navigation.search, item.name, item.portKey, item.description, item.macAddress));
  const generateInterfaces = async () => {
    if (device) {
      await apiGenerateInterfaces(device.id);
      openDevice(device);
    }
  };
  return <InterfaceWorkspace devices={devices} selected={device} interfaces={visibleInterfaces} selectedInterface={selectedInterface} onDevice={openDevice} onInterface={onInterface} onGenerate={generateInterfaces} onEditDevice={() => device && editDevice(device)} />;
}
