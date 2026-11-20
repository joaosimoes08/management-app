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
  isCritical: boolean;
  frontAssetId: string;
  backAssetId?: string;
  /** Image overrides stored when an existing device was opened; absent for a new device. */
  savedAssetIds?: { front: string; rear: string };
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
  backAssetId: string;
}

/**
 * Image override fields for a device save. The API leaves an image alone when its field is absent and clears it on null,
 * so an edit sends a field only when the user changed it, and null only for "use the model image".
 * A new device sends only the images that were chosen.
 */
export function deviceImageFields(form: Pick<DeviceForm, 'frontAssetId' | 'backAssetId' | 'savedAssetIds'>): { frontAssetId?: string | null; backAssetId?: string | null } {
  const current = { front: form.frontAssetId ?? '', rear: form.backAssetId ?? '' };
  const fields: { frontAssetId?: string | null; backAssetId?: string | null } = {};
  const saved = form.savedAssetIds;
  if (saved ? current.front !== saved.front : current.front) fields.frontAssetId = current.front || null;
  if (saved ? current.rear !== saved.rear : current.rear) fields.backAssetId = current.rear || null;
  return fields;
}
