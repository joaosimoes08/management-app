import type { TagSummary } from '@/features/tags/types';
import type { Device, Site } from '@/features/infrastructure/types';

// ── VLANs ──────────────────────────────────────────────────────────────────

export interface Vlan {
  id: string;
  vlanId: number;
  name: string;
  description?: string | null;
  siteId?: string | null;
}

export interface VlanInput {
  vlanId: number;
  name: string;
  description?: string | null;
  siteId?: string | null;
}

// ── Subnets ────────────────────────────────────────────────────────────────

export interface Subnet {
  id: string;
  cidr: string;
  version: number;
  gateway?: string | null;
  purpose?: string | null;
  environment?: string | null;
  siteId?: string | null;
  vlanId?: string | null;
  vrfId?: string | null;
  /** Planning selector: the VRF name, when the list endpoint includes it. */
  vrf?: { id: string; name: string } | null;
  vlan?: Vlan | null;
  site?: Site | null;
  _count?: { ips?: number; discoveryJobs?: number };
  /** Phase E: capacity snapshot from GET /subnets. Optional so older payloads still render. */
  utilization?: SubnetUtilization | null;
  /** Step 36: site-scoped tags, sorted by name. */
  tags?: TagSummary[];
}

/** OK < 80% ≤ WARNING < 90% ≤ CRITICAL; IPv6 is UNTRACKED (no percentage). Unknown bands render generically. */
export type SubnetUtilizationBand = 'OK' | 'WARNING' | 'CRITICAL' | 'UNTRACKED';

export interface SubnetUtilization {
  usableCapacity?: number | null;
  allocated?: number;
  occupied?: number;
  reserved?: number;
  free?: number | null;
  utilizationPercent: number | null;
  band: SubnetUtilizationBand | (string & {});
}

export interface NextFreeIpsQuery { count?: number; from?: string; to?: string }

export interface NextFreeIpsResult {
  subnetId: string;
  cidr: string;
  supported: boolean;
  requested: number;
  items: Array<{ address: string; ipAddressId: string | null; tracked: boolean }>;
  exhausted: boolean;
  message?: string;
}

export interface ReserveNextIpsInput { count?: number; from?: string; to?: string; durationHours: number; reason: string }

export interface ReserveNextIpsResult {
  subnetId: string;
  count: number;
  expiresAt: string;
  reservations: Array<{ id: string; status: string; expiresAt: string; reason: string; ipAddress: { id: string; address: string }; createdIpAddress?: boolean }>;
}

export interface SubnetInput {
  cidr: string;
  version: number;
  vlanId?: string;
  gateway?: string;
  purpose?: string;
  siteId?: string | null;
}

export interface SubnetUsage {
  subnet: Subnet;
  version: number;
  total: number | null;
  usableCapacity: number | null;
  known: number;
  occupied: number;
  reserved: number;
  excluded: number;
  free: number | null;
  byState: Record<string, number>;
  utilizationPercent: number | null;
}

export interface SubnetCapacitySample {
  sampledAt: string;
  version: number;
  usableCapacity: number | null;
  trackedAddresses: number;
  occupiedAddresses: number;
  reservedAddresses: number;
  allocatedAddresses: number;
  freeAddresses: number | null;
  utilizationPercent: number | null;
}

export interface SubnetCapacityHistory {
  subnet: Pick<Subnet, 'id' | 'cidr' | 'version' | 'gateway'>;
  samples: SubnetCapacitySample[];
  forecast: { status: 'AVAILABLE' | 'AT_CAPACITY' | 'INSUFFICIENT_HISTORY' | 'NO_GROWTH' | 'LOW_CONFIDENCE' | 'BEYOND_FORECAST_WINDOW' | 'TRACKING_ONLY'; daysUntilFull: number | null; projectedFullAt: string | null; dailyGrowth: number | null };
}

// ── IP addresses ───────────────────────────────────────────────────────────

export interface IpAddressRow {
  id: string;
  address: string;
  state: string;
  observedState?: string | null;
  lastCheckAt?: string | null;
  lastCheckMethod?: string | null;
  responseMs?: number | null;
  hostname?: string | null;
  macAddress?: string | null;
  notes?: string | null;
  subnetId: string;
  subnet?: { cidr: string } | null;
  host?: { id: string; name: string; _count?: { services?: number } } | null;
  interface?: { id: string; name: string; device?: { name: string } | null } | null;
  reservation?: IpReservation | null;
  reservations?: IpReservation[];
}

export interface IpReservation {
  id: string;
  ipAddressId?: string;
  createdById?: string;
  expiresAt: string;
  reason: string;
  releasedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  status?: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
  ipAddress?: Pick<IpAddressRow, 'id' | 'address'>;
}

export interface CreateIpReservationInput {
  durationHours: number;
  reason: string;
}

export interface IpAddressInput {
  address: string;
  subnetId?: string;
  hostname?: string;
  notes?: string;
}

// ── Hosts and services ─────────────────────────────────────────────────────

export interface ServiceInput {
  name: string;
  protocol?: string;
  port?: number;
  status?: string;
  version?: string;
  notes?: string;
  hostId: string;
}

export interface HostInput {
  name: string;
  hostname?: string;
  operatingSystem?: string;
  macAddress?: string;
  notes?: string;
  status?: string;
  ipAddressId?: string;
}

export interface Service {
  id: string;
  name: string;
  protocol?: string | null;
  port?: number | null;
  status?: string | null;
  observedStatus?: string | null;
  version?: string | null;
  notes?: string | null;
  source?: string;
}

export interface HostRelationIpAddress {
  id: string;
  address: string;
  subnet?: { cidr: string; site?: { name: string } | null; vlan?: { vlanId: number } | null } | null;
  interface?: { id: string; name: string; device?: { name: string } | null } | null;
}

export interface HostDetail {
  id: string;
  name: string;
  hostname?: string | null;
  observedHostname?: string | null;
  operatingSystem?: string | null;
  macAddress?: string | null;
  notes?: string | null;
  status: string;
  observedStatus?: string | null;
  source?: string;
  lastSeenAt?: string | null;
  device?: (Pick<Device, 'id' | 'name'> & {
    model?: { manufacturer: string; model: string } | null;
    rack?: { name: string; room?: { name: string; building?: { name: string } | null } | null } | null;
  }) | null;
  ipAddresses: HostRelationIpAddress[];
  services: Service[];
}

// ── Network map (GET /sites/:siteId/network-map) ───────────────────────────

export interface NetworkMapInterface {
  id: string;
  name: string;
  deviceId: string;
  deviceName: string;
  mode?: string | null;
  relation?: string;
  adminUp?: boolean | null;
  operUp?: boolean | null;
}

export interface NetworkMapDevice {
  id: string;
  name: string;
  type: string;
  status?: string;
  hostname?: string | null;
  model?: { manufacturer: string; model: string } | null;
  interfaces: NetworkMapInterface[];
}

export interface NetworkMapSubnet {
  id: string;
  cidr: string;
  gateway?: string | null;
  purpose?: string | null;
  ipCount: number;
}

export interface NetworkMapVlan {
  id: string;
  vlanId: number;
  name: string;
  description?: string | null;
  subnet: NetworkMapSubnet | null;
  devices: NetworkMapDevice[];
  interfaces: NetworkMapInterface[];
  status?: string;
}

// ── Calculator (POST /ipam/calculator) ─────────────────────────────────────

export type CalculatorOperation = 'summary' | 'split' | 'contains' | 'overlap';

export interface CalculatorInput {
  address: string;
  basePrefix: string;
  newPrefix: string;
  operation?: CalculatorOperation;
  cidr?: string;
  containsAddress?: string;
  cidrsText?: string;
}

export interface CalculatorSubnet {
  number: number;
  cidr: string;
  network: string;
  firstUsable: string;
  lastUsable: string;
  usableRange: string;
  broadcast: string;
  usableIps: number;
}

export interface CalculatorSplitResult {
  parent: string;
  newPrefix: number;
  subnetCount: number;
  subnets: CalculatorSubnet[];
}

export type CalculatorResult = CalculatorSplitResult
  | { version: 4 | 6; prefix: number; network: string; cidr: string; broadcast?: string; firstUsable: string; lastUsable: string; total?: number | string | null }
  | { cidr: string; address?: string; contains: boolean }
  | { cidr: string; overlaps: string[] };

export type IpamAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'DISCOVER' | 'IMPORT';
export interface IpamPermissionGroup {
  id: string;
  name: string;
  siteAssignments: { siteId: string; permissions: { permission: IpamAction }[] }[];
}

// ── VRFs (GET/POST/PATCH/DELETE /vrfs) ───────────────────────────────────────

export interface Vrf {
  id: string;
  name: string;
  routeDistinguisher?: string | null;
  description?: string | null;
  status: string;
  siteId: string;
  createdAt?: string;
  updatedAt?: string;
  _count?: { subnets?: number; natRules?: number };
}

export interface VrfDetail extends Vrf {
  site?: Site | null;
  subnets: Subnet[];
  natRules: NatRule[];
}

/** PATCH uses the full create DTO on the API, so name and siteId are always sent. */
export interface VrfInput {
  name: string;
  routeDistinguisher?: string | null;
  description?: string | null;
  siteId: string;
  status?: string;
}

// ── NAT rules (GET/POST/PATCH/DELETE /nat-rules) ────────────────────────────

export type NatRuleType = 'SNAT' | 'DNAT' | 'STATIC_1_TO_1' | 'PAT';

export interface NatRule {
  id: string;
  name: string;
  type: NatRuleType;
  protocol?: string | null;
  sourceAddress?: string | null;
  translatedAddress?: string | null;
  sourcePort?: number | null;
  translatedPort?: number | null;
  destinationPort?: number | null;
  sourceSubnetId?: string | null;
  translatedSubnetId?: string | null;
  sourceIpId?: string | null;
  translatedIpId?: string | null;
  deviceId?: string | null;
  vrfId?: string | null;
  siteId?: string | null;
  enabled: boolean;
  description?: string | null;
  sourceSubnet?: Pick<Subnet, 'id' | 'cidr'> | null;
  translatedSubnet?: Pick<Subnet, 'id' | 'cidr'> | null;
  sourceIp?: { id: string; address: string } | null;
  translatedIp?: { id: string; address: string } | null;
  device?: { id: string; name: string } | null;
  vrf?: Pick<Vrf, 'id' | 'name'> | null;
}

/** PATCH uses the full create DTO on the API; null clears an optional field. */
export interface NatRuleInput {
  name: string;
  type: NatRuleType;
  protocol?: string | null;
  sourceAddress?: string | null;
  translatedAddress?: string | null;
  sourcePort?: number | null;
  translatedPort?: number | null;
  destinationPort?: number | null;
  sourceSubnetId?: string | null;
  translatedSubnetId?: string | null;
  vrfId?: string | null;
  siteId?: string | null;
  enabled?: boolean;
  description?: string | null;
}

// ── RIPE imports (POST ipam/ripe/preview|import, GET ipam/ripe/imports) ───────

export type RipeQueryType = 'asn' | 'prefix' | 'organisation';

/** POST ipam/ripe/preview: either a RIPEstat query or the raw pasted/uploaded text in `prefixes`. */
export interface RipePreviewInput {
  query?: string;
  queryType?: RipeQueryType;
  prefixes?: string[];
  siteId: string;
  vrfId?: string;
  purpose?: string;
  environment?: string;
}

export type RipeDiffStatus = 'new' | 'changed' | 'exists' | 'conflict';
export type RipeDiffReason = 'NEW' | 'NEW_OVERLAPS_OTHER_SCOPE' | 'EXISTS_SAME' | 'EXISTS_DIFFERENT_ATTRIBUTES' | 'OVERLAP' | 'EXISTS_OUTSIDE_SITE';
/** A subnet the user cannot read comes back as { id: null, cidr: null, hidden: true }. */
export type RipeSubnetRef = { id: string; cidr: string; siteId: string | null; vrfId: string | null; purpose: string | null; environment: string | null; hidden?: false } | { id: null; cidr: null; hidden: true };
export interface RipeDiffItem {
  prefix: string;
  input: string;
  version: 4 | 6;
  status: RipeDiffStatus;
  reason: RipeDiffReason;
  message: string;
  importable: boolean;
  existing?: RipeSubnetRef;
  changes?: Array<{ field: 'vrfId' | 'purpose' | 'environment'; current: string | null; proposed: string | null }>;
  overlaps?: RipeOverlap[];
}
/** `existing`: a subnet already in the inventory (older servers omit `source`). `paste`: an earlier prefix of the same paste, with no `subnet`. */
export type RipeOverlap =
  | { source?: 'existing'; relation: 'contains' | 'within'; sameScope: boolean; subnet?: RipeSubnetRef }
  | { source: 'paste'; relation: 'contains' | 'within'; sameScope: true; prefix: string };
export interface RipeInvalidPrefix { input: string; reason: string; message: string }
export interface RipeDiffTarget { siteId: string; vrfId: string | null; purpose: string | null; environment: string | null }
export interface RipeDiffSummary { total: number; new: number; changed: number; exists: number; conflict: number; importable: number; invalid: number; duplicates: number }

export interface RipePreview {
  id: string;
  query: string;
  queryType: RipeQueryType | 'paste' | string;
  source?: 'PASTE' | 'RIPESTAT' | string;
  prefixes: string[];
  status: string;
  target?: RipeDiffTarget;
  summary?: RipeDiffSummary;
  diff?: RipeDiffItem[];
  invalid?: RipeInvalidPrefix[];
  duplicates?: string[];
  normalized?: Array<{ input: string; prefix: string }>;
}

export interface RipeSkippedPrefix { cidr: string; reason: string }

export interface RipeImportRecord {
  id: string;
  query: string;
  queryType: RipeQueryType | string;
  source: string;
  status: 'PREVIEW' | 'IMPORTED' | 'PARTIAL' | 'FAILED' | string;
  result: { prefixes?: string[]; source?: string; selected?: string[]; created?: string[]; skipped?: RipeSkippedPrefix[]; target?: RipeDiffTarget; diff?: RipeDiffItem[]; summary?: RipeDiffSummary; invalid?: RipeInvalidPrefix[]; duplicates?: string[] } | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface RipeImportInput {
  importId: string;
  prefixes: string[];
  siteId: string;
  vrfId?: string;
  vlanId?: string;
  purpose?: string;
  environment?: string;
}

export interface RipeImportResult {
  status: 'IMPORTED' | 'PARTIAL' | 'FAILED';
  created: Subnet[];
  skipped: RipeSkippedPrefix[];
}

// ── Effective access (shared endpoint with infrastructure) ─────────────────

export type { Site };
