import type { PaginatedResponse } from '@/lib/api/types';

// ── Shared enumerations (mirror Prisma enums / API DTOs) ──────────────────

export type EquipmentType = 'SWITCH' | 'ROUTER' | 'FIREWALL' | 'SERVER' | 'STORAGE' | 'OTHER';
export type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'RETIRED' | 'UNKNOWN';
export type DeviceInterfaceType =
  | 'FAST_ETHERNET'
  | 'ETHERNET'
  | 'GIGABIT_ETHERNET'
  | 'SFP'
  | 'SFP_PLUS'
  | 'QSFP'
  | 'MANAGEMENT'
  | 'CONSOLE'
  | 'FIBRE_CHANNEL'
  | 'OTHER';
export type DeviceInterfaceMode = 'ACCESS' | 'TRUNK' | 'ROUTED';
export type InfrastructureAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';

// ── Physical hierarchy ─────────────────────────────────────────────────────

export interface Site {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Rack as stored; devices are included by GET /sites/:siteId/racks. */
export interface Rack {
  id: string;
  name: string;
  displayOrder?: number;
  units: number;
  modelId?: string | null;
  frontAssetId?: string | null;
  roomId: string;
  room?: Room & { building?: Building };
  model?: DeviceModel | null;
  frontAsset?: AssetFile | null;
  devices?: Device[];
}

export interface Room {
  id: string;
  name: string;
  buildingId: string;
  racks?: Rack[];
  building?: Building;
}

export interface Building {
  id: string;
  name: string;
  siteId?: string;
  description?: string | null;
  rooms?: Room[];
}

/** GET /sites/:siteId/locations returns buildings with nested rooms and racks. */
export interface BuildingWithRooms extends Building {
  rooms?: (Room & { racks?: Rack[] })[];
}

/** Room projected with its building by the workspace (rooms flat-map). */
export interface RoomWithBuilding extends Room {
  building: Building;
}

// ── Assets ─────────────────────────────────────────────────────────────────

export interface AssetFile {
  id: string;
  filename: string;
  storageKey?: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  source?: string;
  license?: string | null;
  createdAt?: string;
}

// ── Device models ──────────────────────────────────────────────────────────

export interface PortLayoutPort {
  portKey: string;
  label?: string;
  interfaceType?: DeviceInterfaceType | string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PortLayout {
  imageWidth?: number;
  imageHeight?: number;
  viewport?: { left: number; top: number; width: number; height: number } | null;
  confidence?: number;
  warnings?: string[];
  confirmedAt?: string;
  ports: PortLayoutPort[];
}

export interface DeviceModel {
  id: string;
  manufacturer: string;
  model: string;
  portCount?: number | null;
  supportsNetworkPorts?: boolean;
  networkPortCount?: number | null;
  type?: EquipmentType | string;
  frontAssetId?: string | null;
  frontAsset?: AssetFile | null;
  iconAsset?: AssetFile | null;
  portLayout?: PortLayout | number | null;
}

// ── Devices and interfaces ─────────────────────────────────────────────────

export interface Device {
  id: string;
  name: string;
  type: EquipmentType | string;
  serialNumber?: string | null;
  assetTag?: string | null;
  hostname?: string | null;
  managementIp?: string | null;
  notes?: string | null;
  source?: string;
  status: AssetStatus | string;
  modelId?: string | null;
  rackId?: string | null;
  rackUnitStart?: number | null;
  rackUnitSize?: number | null;
  siteId?: string | null;
  frontAssetId?: string | null;
  model?: DeviceModel | null;
  frontAsset?: AssetFile | null;
  site?: Site | null;
  rack?: Omit<Rack, 'devices'> & { room?: Room & { building?: Building } } | null;
  interfaces?: DeviceInterface[];
  ipAddresses?: IpAddress[];
}

export interface Vlan {
  id: string;
  vlanId: number;
  name: string;
  description?: string | null;
  siteId?: string | null;
  site?: Site | null;
  subnets?: { id: string; cidr: string; siteId?: string | null }[];
}

export interface InterfaceAllowedVlan {
  vlanId: string;
  tagged?: boolean;
  vlan?: Vlan;
}

export interface DeviceInterface {
  id: string;
  name: string;
  portKey?: string | null;
  interfaceType?: DeviceInterfaceType | string | null;
  description?: string | null;
  adminUp?: boolean;
  operUp?: boolean;
  speedMbps?: number | null;
  mode?: DeviceInterfaceMode | string | null;
  nativeVlanId?: string | null;
  accessVlanId?: string | null;
  macAddress?: string | null;
  deviceId: string;
  nativeVlan?: Vlan | null;
  accessVlan?: Vlan | null;
  allowedVlans?: InterfaceAllowedVlan[];
  ipAddresses?: IpAddress[];
}

export interface IpAddress {
  id: string;
  address: string;
  hostname?: string | null;
  state?: string;
  version?: number;
  subnetId: string;
  deviceId?: string | null;
  interfaceId?: string | null;
}

// ── Placement planning (POST /devices/:id/placement/preview) ───────────────

export interface RackPlacementChange {
  id: string;
  name: string;
  rackId: string;
  rackUnitStart: number;
  rackUnitSize: number;
  rackName?: string;
  reason?: string;
}

export interface RackPlacementPlan {
  target: RackPlacementChange;
  changes: RackPlacementChange[];
}

// ── Effective access (GET /access/effective) ───────────────────────────────

export interface EffectiveAccess {
  siteId: string;
  capabilities: {
    administer: boolean;
    network: boolean;
    systems: boolean;
    audit: boolean;
    readOnly: boolean;
  };
  ipamActions: string[];
  infrastructure: {
    site: InfrastructureAction[];
    buildings: { id: string; actions: InfrastructureAction[] }[];
    rooms: { id: string; actions: InfrastructureAction[] }[];
  };
  tabs: {
    permissions: boolean;
    assets: boolean;
    models: boolean;
    interfaces: boolean;
    discovery: boolean;
  };
}

// ── Request payloads ───────────────────────────────────────────────────────

export interface DeviceInput {
  name: string;
  type: EquipmentType | string;
  hostname?: string | null;
  managementIp?: string | null;
  managementIpAddressId?: string | null;
  rackId?: string | null;
  rackUnitStart?: number | null;
  rackUnitSize?: number;
  modelId?: string | null;
  status?: AssetStatus | string;
  frontAssetId?: string | null;
  siteId?: string | null;
  notes?: string | null;
}

export interface InterfaceInput {
  name: string;
  portKey?: string | null;
  interfaceType?: DeviceInterfaceType | string;
  description?: string | null;
  adminUp?: boolean;
  operUp?: boolean;
  speedMbps?: number | null;
  mode?: DeviceInterfaceMode | string;
  nativeVlanId?: string | null;
  accessVlanId?: string | null;
  allowedVlanIds?: string[];
  macAddress?: string | null;
}

export type SiteListResponse = PaginatedResponse<Site>;

export type DeviceListResponse = PaginatedResponse<Device>;
export type VlanListResponse = PaginatedResponse<Vlan>;

/** Draft passed to the rack editor modal, either an existing rack or a blank "new rack" seed. */
export interface RackEditDraft {
  id?: string;
  name?: string;
  units?: number | string;
  roomId?: string;
  room?: { id: string; name?: string; building?: { id?: string; name?: string } | null };
  modelId?: string | null;
  model?: { id?: string } | null;
  frontAssetId?: string | null;
  frontAsset?: { id?: string } | null;
}
