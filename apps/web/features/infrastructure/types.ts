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
  /** Power distribution: one SUPPLIER PDU always, plus a UPS PDU when the rack has a UPS feed. */
  pdus?: RackPdu[];
  /** Derived by the API: a UPS PDU exists => SUPPLIER_AND_UPS ("Rede + UPS"). */
  powerMode?: RackPowerMode;
  power?: { mode: RackPowerMode; totals: RackPowerTotals } | null;
}

// ── Rack power (PDUs, outlets, estimated watts) ───────────────────────────

/** Feed a PDU is on: the supplier mains ("Rede") or the UPS. */
export type PowerFeedSource = 'SUPPLIER' | 'UPS';
/** "Só rede elétrica" or "Rede + UPS". */
export type RackPowerMode = 'SUPPLIER_ONLY' | 'SUPPLIER_AND_UPS';
/** Where the API says a watt (or plug) value came from. */
export type ApiPowerValueSource = 'manual' | 'modelo' | 'padrão';
export type ApiLoadLevel = 'ok' | 'warning' | 'critical';

export interface RackPowerTotals { estimatedWatts: number; bySource: Partial<Record<PowerFeedSource, number>>; unconnectedDeviceIds?: string[] }

/** The API's power summary for one device in a rack (GET racks / sites/:id/racks). */
export interface DevicePowerSummary {
  deviceId: string;
  plugCount: number;
  plugCountSource: ApiPowerValueSource;
  estimatedWatts: number;
  wattsSource: ApiPowerValueSource;
  connectedPlugs: number;
  redundant: boolean;
  assignments: { plugIndex: number; pduId: string; source: PowerFeedSource; outletIndex: number }[];
}

/** One occupied outlet: the device plug plugged into it. */
export interface PduOutlet { outletIndex: number; plugIndex: number }

/** A device plugged into a PDU, with its outlets on that PDU. */
export interface PduConnection {
  deviceId: string;
  deviceName: string;
  /** Outlets this device uses on this PDU. Older payloads may send bare outlet numbers. */
  outlets: (PduOutlet | number)[];
  deviceType?: string;
  /** The device's estimated load carried by this PDU in normal operation. */
  estimatedWattsShare?: number | null;
  /** The device's whole estimated load (all plugs): what this PDU carries if the other feed fails. */
  deviceEstimatedWatts?: number | null;
  wattsSource?: ApiPowerValueSource;
}

export interface RackPdu {
  id: string;
  rackId: string;
  source: PowerFeedSource;
  name?: string | null;
  outletCount: number;
  budgetWatts?: number | null;
  usedOutlets?: number;
  freeOutlets?: number;
  estimatedWatts?: number;
  /** Load on this PDU if the other feed fails (dual-fed devices move their whole load here). */
  failoverWatts?: number | null;
  levels?: { outlets: ApiLoadLevel; watts: ApiLoadLevel; failoverWatts: ApiLoadLevel };
  connections?: PduConnection[];
}

/** Where a device's estimated watts come from: set on the device, the model's typical value, or the type default. */
export type WattsSource = 'manual' | 'model' | 'default';

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

/** One physical face of a device. Devices are full depth, so each one has both. */
export type RackFace = 'front' | 'rear';
/** Rack page view: one face, or both side by side. */
export type RackView = RackFace | 'both';

export interface PortLayout {
  imageWidth?: number;
  imageHeight?: number;
  viewport?: { left: number; top: number; width: number; height: number } | null;
  confidence?: number;
  warnings?: string[];
  confirmedAt?: string;
  ports: PortLayoutPort[];
}

/** One face of a v2 port layout; same entry shape as v1. */
export type PortLayoutFace = PortLayout;

/** Port layout as returned by the API: always v2 with optional faces. */
export interface PortLayoutV2 {
  version: 2;
  faces: Partial<Record<RackFace, PortLayoutFace>>;
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
  backAssetId?: string | null;
  backAsset?: AssetFile | null;
  iconAsset?: AssetFile | null;
  /** Power plugs (PSUs) of this model; null means unknown (the UI then assumes 2). */
  powerPlugCount?: number | null;
  typicalWatts?: number | null;
  maxWatts?: number | null;
  /** v2 from the API; v1 and numeric seeds are still read for older payloads. */
  portLayout?: PortLayoutV2 | PortLayout | number | null;
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
  isCritical?: boolean;
  source?: string;
  status: AssetStatus | string;
  modelId?: string | null;
  rackId?: string | null;
  rackUnitStart?: number | null;
  rackUnitSize?: number | null;
  /** Per-device override of the model's plug count; null falls back to the model, then to 2. */
  powerPlugCount?: number | null;
  /** Per-device estimated load in W; null falls back to the model's typical watts, then to the type default. */
  estimatedWatts?: number | null;
  /** Effective plug count, watts and outlets, computed by the API (present on devices loaded with their rack). */
  power?: DevicePowerSummary | null;
  siteId?: string | null;
  frontAssetId?: string | null;
  backAssetId?: string | null;
  /** Required configs this device lacks (GET /devices, GET /devices/:id). */
  requiredConfig?: { missing: string[]; missingTabs: string[]; complete: boolean } | null;
  model?: DeviceModel | null;
  frontAsset?: AssetFile | null;
  backAsset?: AssetFile | null;
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

export interface InfrastructureAccessGroup { id: string; name: string }
export interface InfrastructurePermission {
  id: string;
  scopeType: 'SITE' | 'BUILDING' | 'ROOM';
  scopeId: string;
  permission: InfrastructureAction;
  group?: InfrastructureAccessGroup;
}

// ── Request payloads ───────────────────────────────────────────────────────

/** Per-PDU settings. Omitted = keep (or default on creation); null clears name / budget. */
export interface PduSettingsInput { name?: string | null; outletCount?: number; budgetWatts?: number | null }

/** PUT /racks/:id/pdus. SUPPLIER_ONLY removes the UPS PDU (409 PDU_HAS_CONNECTIONS while devices are plugged in). */
export interface RackPowerInput { mode: RackPowerMode; supplier?: PduSettingsInput; ups?: PduSettingsInput }

/** One plug in PUT /devices/:id/power. pduId null = "Não ligado"; outletIndex null = lowest free outlet. */
export interface PlugAssignmentInput { plugIndex: number; pduId: string | null; outletIndex?: number | null }

/** PUT /devices/:id/power: replaces every outlet of the device. plugs omitted = default split; [] = unplug all. */
export interface DevicePowerInput { powerPlugCount?: number | null; estimatedWatts?: number | null; plugs?: PlugAssignmentInput[] }

/** details.devices of a 409 PDU_HAS_CONNECTIONS / PDU_OUTLETS_IN_USE: the devices that block the change. */
export interface PowerConflictDevice { deviceId: string; deviceName: string; outlets: number[] }
export interface PowerConflictDetails { pduId: string; source: PowerFeedSource; outletCount?: number; devices: PowerConflictDevice[] }

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
  pdus?: RackPdu[];
  powerMode?: RackPowerMode;
}
