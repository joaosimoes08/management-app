import * as snmp from 'net-snmp';
import { fallbackOnPortsWithoutLldp, FallbackNeighbor, neighborVendorFor, NeighborProtocol, SnmpWalk } from '@simoes/snmp-core';
import { LldpNeighbor, PollResult, subtree } from './client';
import { normaliseVarbind } from './device-health';

type Session = ReturnType<typeof snmp.createSession>;

/** One neighbour row as the poller stores it: an LLDP row, or a vendor fallback row mapped to the same fields. */
export type ObservedNeighbor = LldpNeighbor & { protocol: NeighborProtocol };

/**
 * SNMP Phase 2 step 11: walks the vendor's fallback neighbour protocol (CDP for Cisco; nothing for other vendors).
 * Best effort: a failed or absent walk returns no rows and never fails the poll.
 */
export async function pollFallbackNeighbors(session: Session, sysObjectId: string | null | undefined, walkSubtree = subtree): Promise<FallbackNeighbor[]> {
  const vendor = neighborVendorFor(sysObjectId);
  if (!vendor.fallbackWalks.length) return [];
  const walk: SnmpWalk = new Map();
  const results = await Promise.allSettled(vendor.fallbackWalks.map((oid) => walkSubtree(session, oid)));
  for (const result of results) {
    if (result.status === 'rejected') continue;
    for (const varbind of result.value) {
      const value = normaliseVarbind(varbind);
      if (value !== null) walk.set(String(varbind.oid).replace(/^\./, ''), value);
    }
  }
  return vendor.parseFallback(walk);
}

/**
 * The neighbours to store for one poll: every LLDP row, plus the fallback rows on ports where LLDP saw no
 * neighbour. A fallback row's local port is named by its ifName, so it matches the documented interface the same
 * way an LLDP row does.
 */
export function observedNeighbors(lldp: LldpNeighbor[], fallback: FallbackNeighbor[], interfaces: PollResult['interfaces']): ObservedNeighbor[] {
  const byIndex = new Map(interfaces.map((item) => [item.ifIndex, item]));
  const extra = fallbackOnPortsWithoutLldp(fallback, lldp, interfaces).map((item): ObservedNeighbor => ({
    protocol: item.protocol,
    localPortNumber: item.ifIndex,
    localPortId: byIndex.get(item.ifIndex)?.name || byIndex.get(item.ifIndex)?.description || undefined,
    remoteIndex: item.remoteIndex,
    chassisId: item.remoteDeviceId ?? undefined,
    portId: item.remotePort ?? undefined,
    systemName: item.remoteDeviceId ?? undefined,
    managementAddress: item.managementAddress ?? undefined,
    rawIdentifiers: { ...item.rawIdentifiers, platform: item.platform, capabilities: item.capabilities, softwareVersion: item.softwareVersion },
  }));
  return [...lldp.map((item): ObservedNeighbor => ({ ...item, protocol: 'LLDP' })), ...extra];
}
