import { apiFetch } from '@/lib/api/client';

/** Step 34 contract (`GET /v1/topology/impact` and `GET /v1/topology/path`, PR #109). */
export type ImpactTarget = { kind: 'DEVICE' | 'PDU' | 'RACK'; id: string };
export type ImpactDevice = { id: string; name: string; type: string; status: string; hostname: string | null; managementIp: string | null; isCritical: boolean; criticalityTier: string | null; rackId: string | null };
export type ImpactDownDevice = ImpactDevice & { reason: 'ORIGIN' | 'RACK' | 'POWER' };
export type ImpactAffectedDevice = ImpactDevice & { hops: number; viaDeviceId: string | null; viaConnectionId: string | null };
export type ImpactHost = { id: string; name: string; hostname: string | null; status: string; deviceId: string | null; services: Array<{ id: string; name: string; protocol?: string | null; port?: number | null; status?: string | null }> };
export type ImpactApplication = { id: string; name: string; url: string; category?: string | null; matchedHost: string };
export type TopologyImpact = {
  origin: { kind: ImpactTarget['kind']; id: string; name: string };
  siteId: string | null;
  maxDepth: number;
  includeLogical: boolean;
  truncated: boolean;
  anchorMode: 'explicit' | 'gateway-devices' | 'largest-segment' | string;
  anchorDeviceIds: string[];
  down: ImpactDownDevice[];
  affected: ImpactAffectedDevice[];
  powerDegraded: ImpactDevice[];
  hosts: ImpactHost[];
  applications: ImpactApplication[];
  critical: { T1: string[]; T2: string[]; T3: string[]; untiered: string[] };
  counts: { down: number; affected: number; powerDegraded: number; hosts: number; services: number; applications: number; tier1: number };
  hiddenCount: number;
  elapsedMs: number;
};
export type PathStep = ({ hidden: false } & ImpactDevice) | { hidden: true; id: null };
export type PathLink = { hidden: false; id: string; type: string; label: string | null; sourceDeviceId: string; targetDeviceId: string; sourceInterface: { id: string; name: string } | null; targetInterface: { id: string; name: string } | null } | { hidden: true; id: null };
export type TopologyPath = { found: boolean; reason?: 'DIFFERENT_SITES' | 'NO_PATH' | string; hops?: number; maxDepth: number; includeLogical: boolean; steps: PathStep[]; connections: PathLink[] };

const PARAM: Record<ImpactTarget['kind'], string> = { DEVICE: 'deviceId', PDU: 'pduId', RACK: 'rackId' };

export function getTopologyImpact(target: ImpactTarget, options: { includeLogical?: boolean } = {}) {
  const params = new URLSearchParams({ [PARAM[target.kind]]: target.id });
  if (options.includeLogical) params.set('includeLogical', 'true');
  return apiFetch<TopologyImpact>(`/api/v1/topology/impact?${params.toString()}`);
}

export function getTopologyPath(fromDeviceId: string, toDeviceId: string, options: { includeLogical?: boolean } = {}) {
  const params = new URLSearchParams({ fromDeviceId, toDeviceId });
  if (options.includeLogical) params.set('includeLogical', 'true');
  return apiFetch<TopologyPath>(`/api/v1/topology/path?${params.toString()}`);
}

/** `device:<id>` / `pdu:<id>` / `rack:<id>`, used in the `impact` URL parameter of the Topologia page. */
export function impactParam(target: ImpactTarget) { return `${target.kind.toLowerCase()}:${target.id}`; }
export function parseImpactParam(value: string | null | undefined): ImpactTarget | null {
  const match = /^(device|pdu|rack):([0-9a-f-]{36})$/i.exec(value ?? '');
  return match ? { kind: match[1].toUpperCase() as ImpactTarget['kind'], id: match[2] } : null;
}
export function topologyImpactHref(target: ImpactTarget, siteId?: string | null) {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  params.set('impact', impactParam(target));
  return `/topology?${params.toString()}`;
}
