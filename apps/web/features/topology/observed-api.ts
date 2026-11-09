import { apiFetch } from '@/lib/api/client';

export interface SnmpInterfaceObservation {
  id: string;
  ifIndex: number;
  name?: string | null;
  description?: string | null;
  alias?: string | null;
  interfaceType?: number | null;
  macAddress?: string | null;
  adminUp?: boolean | null;
  operUp?: boolean | null;
  speedMbps?: number | null;
  counters?: Record<string, unknown> | null;
}
export interface SnmpDeviceOverview {
  latestSnapshot?: { id: string; observedAt: string; sysName?: string | null; sysDescr?: string | null; interfaces: SnmpInterfaceObservation[] } | null;
}
export interface LldpObservation {
  id: string;
  deviceId: string;
  snapshotId?: string | null;
  source: string;
  observedAt: string;
  confidence: number;
  localPortNumber?: number | null;
  localPortId?: string | null;
  localPortDescription?: string | null;
  remoteChassisIdSubtype?: number | null;
  remoteChassisId?: string | null;
  remotePortIdSubtype?: number | null;
  remotePortId?: string | null;
  remotePortDescription?: string | null;
  remoteSystemName?: string | null;
  managementAddress?: string | null;
  resolvedDeviceId?: string | null;
  rawIdentifiers?: Record<string, unknown> | null;
}
export type TopologyProposalAction = 'ADD' | 'UPDATE' | 'REMOVAL_CANDIDATE' | 'CONNECTION_ADD' | 'CONNECTION_UPDATE';
export type TopologyProposalStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'UNDONE';
export interface TopologyProposal {
  id: string;
  deviceId: string;
  interfaceId?: string | null;
  action: TopologyProposalAction;
  status: TopologyProposalStatus;
  proposalKey: string;
  observedIfIndex?: number | null;
  confidence: number;
  source: string;
  context?: Record<string, unknown> | null;
  beforeValues?: Record<string, unknown> | null;
  observedValues?: Record<string, unknown> | null;
  appliedEntityId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  appliedAt?: string | null;
  undoneAt?: string | null;
  createdAt: string;
  snapshot: { observedAt: string };
  interface?: { id: string; name: string } | null;
}

export function getSnmpDeviceOverview(deviceId: string) {
  return apiFetch<SnmpDeviceOverview>(`/api/v1/snmp/devices/${encodeURIComponent(deviceId)}`);
}
export function listDeviceLldpObservations(deviceId: string) {
  return apiFetch<LldpObservation[]>(`/api/v1/snmp/devices/${encodeURIComponent(deviceId)}/lldp-observations`);
}
export function listDeviceTopologyProposals(deviceId: string) {
  return apiFetch<TopologyProposal[]>(`/api/v1/snmp/devices/${encodeURIComponent(deviceId)}/topology-proposals`);
}
export function applyTopologyProposal(id: string) {
  return apiFetch<TopologyProposal>(`/api/v1/snmp/topology-proposals/${encodeURIComponent(id)}/apply`, { method: 'POST' });
}
export function rejectTopologyProposal(id: string) {
  return apiFetch<TopologyProposal>(`/api/v1/snmp/topology-proposals/${encodeURIComponent(id)}/reject`, { method: 'POST' });
}
export function undoTopologyProposal(id: string) {
  return apiFetch<TopologyProposal>(`/api/v1/snmp/topology-proposals/${encodeURIComponent(id)}/undo`, { method: 'POST' });
}
