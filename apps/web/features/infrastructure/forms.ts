export interface BuildingForm {
  name: string;
  description: string;
}

export interface RoomForm {
  name: string;
  buildingId: string;
}

export interface RackForm {
  name: string;
  units: string;
  roomId: string;
  modelId: string;
  frontAssetId: string;
}

export interface DeviceForm {
  name: string;
  type: string;
  hostname: string;
  managementIp: string;
  managementIpAddressId: string;
  rackId: string;
  rackUnitStart: string;
  rackUnitSize: string;
  modelId: string;
  status: string;
  frontAssetId: string;
  notes?: string;
}

export interface ModelForm {
  manufacturer: string;
  model: string;
  type: string;
  supportsNetworkPorts: boolean;
  networkPortCount: string;
  frontAssetId: string;
}
