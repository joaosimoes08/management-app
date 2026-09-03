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
  snmpEnabled?: boolean;
  snmpVersion?: 'V2C' | 'V3';
  snmpReadUsername?: string;
  snmpReadCommunity?: string;
  snmpReadAuthKey?: string;
  snmpReadPrivKey?: string;
  snmpTrapEnabled?: boolean;
  snmpTrapUsername?: string;
  snmpTrapCommunity?: string;
  snmpTrapAuthKey?: string;
  snmpTrapPrivKey?: string;
  snmpAuthProtocol?: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512';
  snmpPrivProtocol?: 'AES128' | 'AES256';
  snmpCompatibilitySha1?: boolean;
  snmpPort?: string;
  snmpIntervalMinutes?: string;
  snmpTimeoutMs?: string;
  snmpRetries?: string;
}

export interface ModelForm {
  manufacturer: string;
  model: string;
  type: string;
  supportsNetworkPorts: boolean;
  networkPortCount: string;
  frontAssetId: string;
}
