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
  vlan?: Vlan | null;
  site?: Site | null;
  _count?: { ips?: number; discoveryJobs?: number };
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
  total: number | bigint | null;
  theoreticalCapacity: number;
  known: number;
  occupied: number;
  free: number | null;
  byState: Record<string, number>;
  utilizationPercent: number | null;
}

// ── IP addresses ───────────────────────────────────────────────────────────

export interface IpAddressRow {
  id: string;
  address: string;
  state: string;
  observedState?: string | null;
  hostname?: string | null;
  macAddress?: string | null;
  notes?: string | null;
  subnetId: string;
  host?: { id: string; name: string; _count?: { services?: number } } | null;
  interface?: { id: string; name: string; device?: { name: string } | null } | null;
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

// ── Calculator (POST /ipam/calculator with operation "split") ──────────────

export interface CalculatorInput {
  address: string;
  basePrefix: string;
  newPrefix: string;
  operation?: string;
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

export interface CalculatorResult {
  parent: string;
  newPrefix: number;
  subnetCount: number;
  subnets: CalculatorSubnet[];
}

// ── Effective access (shared endpoint with infrastructure) ─────────────────

export type { Site };
