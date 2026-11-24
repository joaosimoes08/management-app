/**
 * Discovery D-P1d: links discovery candidates (addresses found by a subnet scan) to the LLDP/CDP observation and
 * topology proposal flow. Read-only: nothing here creates, applies or changes a proposal. Links still need a reviewer
 * to apply them on the device's topology proposals, with the existing stale checks.
 */

/** How far back neighbour evidence is shown. Older sightings are not evidence of a current neighbour. */
export const NEIGHBOR_EVIDENCE_WINDOW_DAYS = 7;
/** Upper bound on observations read for one discovery job (one row per poll per neighbour). */
export const NEIGHBOR_EVIDENCE_MAX_OBSERVATIONS = 5000;

export type NeighborResolution =
  /** The poll resolved the address to exactly one device on the Site; a link proposal can exist. */
  | 'RESOLVED'
  /** Not resolved at poll time, but exactly one device on the Site has this management IP now: the observing device's next poll resolves it. */
  | 'REGISTERED'
  /** More than one device on the Site has this management IP; the poll never resolves it until that is fixed. Defensive: (siteId, managementIp) is unique today. */
  | 'AMBIGUOUS'
  /** No device on the Site has this management IP: the neighbour is only a discovery candidate. */
  | 'UNREGISTERED';

export type EvidenceObservation = {
  id: string;
  deviceId: string;
  deviceName: string;
  snapshotId: string | null;
  protocol: string;
  observedAt: Date;
  confidence: number;
  localPortNumber: number | null;
  localPortId: string | null;
  localPortDescription: string | null;
  remoteSystemName: string | null;
  remotePortId: string | null;
  remoteChassisId: string | null;
  managementAddress: string | null;
  resolvedDeviceId: string | null;
};

export type EvidenceProposal = {
  id: string;
  deviceId: string | null;
  action: string;
  status: string;
  confidence: number;
  createdAt: Date;
  context: unknown;
  observedValues: unknown;
};

export type NeighborEvidence = {
  observationId: string;
  protocol: string;
  observedAt: Date;
  /** True when the sighting comes from the observing device's latest poll; false means the neighbour was not seen since. */
  current: boolean;
  confidence: number;
  observer: { deviceId: string; name: string; localPortId: string | null; localPortNumber: number | null; localPortDescription: string | null };
  remote: { systemName: string | null; portId: string | null; chassisId: string | null };
  resolution: NeighborResolution;
  /** Devices the caller may read; RESOLVED/REGISTERED devices the caller may not read are left out. */
  devices: { id: string; name: string }[];
  proposal: { id: string; action: string; status: string; confidence: number; createdAt: Date; match: 'OBSERVATION' | 'DEVICE_PAIR' } | null;
};

const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const LINK_ACTIONS = new Set(['CONNECTION_ADD', 'CONNECTION_UPDATE']);
const rank = (item: EvidenceProposal) => (item.status === 'PENDING' ? 0 : 1);

/** Picks the proposal for one neighbour: the one its own sightings created, otherwise a pending one between the same two devices. */
function proposalFor(observationIds: Set<string>, observerId: string, resolvedDeviceId: string | null, proposals: EvidenceProposal[]): NeighborEvidence['proposal'] {
  const links = proposals.filter((item) => LINK_ACTIONS.has(item.action));
  const byNewest = (a: EvidenceProposal, b: EvidenceProposal) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime();
  const own = links.filter((item) => observationIds.has(String(object(item.context).observationId ?? ''))).sort(byNewest)[0];
  if (own) return { id: own.id, action: own.action, status: own.status, confidence: own.confidence, createdAt: own.createdAt, match: 'OBSERVATION' };
  if (!resolvedDeviceId) return null;
  const pair = [observerId, resolvedDeviceId].sort().join('|');
  const shared = links.filter((item) => item.status === 'PENDING' && (() => {
    const values = object(item.observedValues);
    return [String(values.sourceDeviceId ?? ''), String(values.targetDeviceId ?? '')].sort().join('|') === pair;
  })()).sort(byNewest)[0];
  return shared ? { id: shared.id, action: shared.action, status: shared.status, confidence: shared.confidence, createdAt: shared.createdAt, match: 'DEVICE_PAIR' } : null;
}

/**
 * Groups observations per address and per observing port, newest sighting first, and attaches freshness, resolution
 * and the matching link proposal. `registered` lists every device on the Site per management IP (for the ambiguity
 * count); `readable` says which of those the caller may see.
 */
export function buildNeighborEvidence(input: {
  observations: EvidenceObservation[];
  latestSnapshotByDevice: Map<string, string>;
  registered: Map<string, { id: string; name: string }[]>;
  readableDeviceIds: Set<string>;
  proposals: EvidenceProposal[];
}): Map<string, NeighborEvidence[]> {
  const groups = new Map<string, EvidenceObservation[]>();
  for (const item of input.observations) {
    if (!item.managementAddress) continue;
    const port = item.localPortId?.toLowerCase() ?? `#${item.localPortNumber ?? ''}`;
    const key = `${item.managementAddress}|${item.deviceId}|${port}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const byAddress = new Map<string, NeighborEvidence[]>();
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || a.id.localeCompare(b.id));
    const newest = sorted[0];
    const address = newest.managementAddress as string;
    const registered = input.registered.get(address) ?? [];
    const resolution: NeighborResolution = newest.resolvedDeviceId ? 'RESOLVED' : registered.length === 1 ? 'REGISTERED' : registered.length > 1 ? 'AMBIGUOUS' : 'UNREGISTERED';
    const deviceIds = newest.resolvedDeviceId ? [newest.resolvedDeviceId] : registered.map((item) => item.id);
    const names = new Map(registered.map((item) => [item.id, item.name]));
    const devices = deviceIds.filter((id) => input.readableDeviceIds.has(id)).map((id) => ({ id, name: names.get(id) ?? '' }));
    const visibleProposals = input.proposals.filter((item) => item.deviceId && input.readableDeviceIds.has(item.deviceId));
    byAddress.set(address, [...(byAddress.get(address) ?? []), {
      observationId: newest.id,
      protocol: newest.protocol,
      observedAt: newest.observedAt,
      current: Boolean(newest.snapshotId) && input.latestSnapshotByDevice.get(newest.deviceId) === newest.snapshotId,
      confidence: newest.confidence,
      observer: { deviceId: newest.deviceId, name: newest.deviceName, localPortId: newest.localPortId, localPortNumber: newest.localPortNumber, localPortDescription: newest.localPortDescription },
      remote: { systemName: newest.remoteSystemName, portId: newest.remotePortId, chassisId: newest.remoteChassisId },
      resolution,
      devices,
      proposal: proposalFor(new Set(sorted.map((item) => item.id)), newest.deviceId, newest.resolvedDeviceId, visibleProposals),
    }]);
  }
  for (const list of byAddress.values()) list.sort((a, b) => Number(b.current) - Number(a.current) || b.observedAt.getTime() - a.observedAt.getTime() || a.observer.name.localeCompare(b.observer.name));
  return byAddress;
}
