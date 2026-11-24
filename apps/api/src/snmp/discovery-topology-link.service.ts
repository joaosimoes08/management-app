import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { buildNeighborEvidence, NEIGHBOR_EVIDENCE_MAX_OBSERVATIONS, NEIGHBOR_EVIDENCE_WINDOW_DAYS } from './discovery-topology-link';

const DAY_MS = 86_400_000;
const LINK_ACTIONS = ['CONNECTION_ADD', 'CONNECTION_UPDATE'] as const;

/**
 * Discovery D-P1d: the read side that joins discovery results and LLDP/CDP observations by management address,
 * within one Site. Everything is filtered by the caller's device and subnet scope; nothing is written.
 */
@Injectable()
export class DiscoveryTopologyLinkService {
  constructor(private readonly prisma: PrismaClient, private readonly infrastructure: InfrastructureAccessService, private readonly ipam: IpamAccessService) {}

  /** The subset of `ids` the caller may read. Scope errors hide the device; any other error is raised. */
  private async readableDevices(user: AuthenticatedUser, ids: Iterable<string>) {
    const readable = new Set<string>();
    for (const id of new Set(ids)) {
      try { await this.infrastructure.assertDevice(user, 'READ', id); readable.add(id); } catch (error) { if (!(error instanceof HttpException)) throw error; }
    }
    return readable;
  }

  /**
   * GET /snmp/discovery/jobs/:jobId/neighbors: for each result of the job, which polled devices on the subnet's Site
   * see that address as an LLDP/CDP neighbour, on which port, how fresh, whether it resolves to a device, and the
   * link proposal waiting for review. Only results with at least one neighbour are returned.
   */
  async jobNeighbors(user: AuthenticatedUser, jobId: string, now = new Date()) {
    const job = await this.prisma.discoveryJob.findUnique({ where: { id: jobId }, select: { id: true, subnetId: true, subnet: { select: { siteId: true } } } });
    if (!job) throw new NotFoundException({ code: 'DISCOVERY_JOB_NOT_FOUND', message: 'Execução de discovery não encontrada.' });
    await this.ipam.assertSubnet(user, 'READ', job.subnetId);
    const siteId = job.subnet.siteId;
    const empty = { jobId, siteId, windowDays: NEIGHBOR_EVIDENCE_WINDOW_DAYS, results: [] as unknown[] };
    if (!siteId) return empty;
    const results = await this.prisma.discoveryResult.findMany({ where: { jobId }, select: { id: true, address: true, status: true }, orderBy: { address: 'asc' } });
    const addresses = [...new Set(results.map((item) => item.address))];
    if (!addresses.length) return empty;
    const since = new Date(now.getTime() - NEIGHBOR_EVIDENCE_WINDOW_DAYS * DAY_MS);

    const [rows, registered] = await Promise.all([
      this.prisma.lldpObservation.findMany({
        where: { managementAddress: { in: addresses }, observedAt: { gte: since }, device: { siteId } },
        select: { id: true, deviceId: true, snapshotId: true, protocol: true, observedAt: true, confidence: true, localPortNumber: true, localPortId: true, localPortDescription: true, remoteSystemName: true, remotePortId: true, remoteChassisId: true, managementAddress: true, resolvedDeviceId: true, device: { select: { name: true } } },
        orderBy: [{ observedAt: 'desc' }, { id: 'asc' }],
        take: NEIGHBOR_EVIDENCE_MAX_OBSERVATIONS,
      }),
      this.prisma.device.findMany({ where: { siteId, managementIp: { in: addresses } }, select: { id: true, name: true, managementIp: true } }),
    ]);
    const readable = await this.readableDevices(user, [...rows.map((item) => item.deviceId), ...rows.flatMap((item) => (item.resolvedDeviceId ? [item.resolvedDeviceId] : [])), ...registered.map((item) => item.id)]);
    const observations = rows.filter((item) => readable.has(item.deviceId)).map(({ device, ...item }) => ({ ...item, protocol: String(item.protocol), deviceName: device.name }));
    if (!observations.length) return empty;
    const observerIds = [...new Set(observations.map((item) => item.deviceId))];
    const partnerIds = observations.flatMap((item) => (item.resolvedDeviceId && readable.has(item.resolvedDeviceId) ? [item.resolvedDeviceId] : []));

    const [snapshots, proposals] = await Promise.all([
      this.prisma.snmpSnapshot.findMany({ where: { deviceId: { in: observerIds } }, orderBy: [{ deviceId: 'asc' }, { observedAt: 'desc' }], distinct: ['deviceId'], select: { id: true, deviceId: true } }),
      this.prisma.topologyProposal.findMany({
        where: { deviceId: { in: [...new Set([...observerIds, ...partnerIds])] }, action: { in: [...LINK_ACTIONS] }, OR: [{ status: 'PENDING' }, { createdAt: { gte: since } }] },
        select: { id: true, deviceId: true, action: true, status: true, confidence: true, createdAt: true, context: true, observedValues: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
    ]);
    const byIp = new Map<string, { id: string; name: string }[]>();
    for (const item of registered) if (item.managementIp) byIp.set(item.managementIp, [...(byIp.get(item.managementIp) ?? []), { id: item.id, name: item.name }]);
    const evidence = buildNeighborEvidence({
      observations,
      latestSnapshotByDevice: new Map(snapshots.map((item) => [item.deviceId, item.id])),
      registered: byIp,
      readableDeviceIds: readable,
      proposals: proposals.map((item) => ({ ...item, action: String(item.action), status: String(item.status) })),
    });
    return { ...empty, results: results.filter((item) => evidence.has(item.address)).map((item) => ({ resultId: item.id, address: item.address, status: item.status, neighbors: evidence.get(item.address) })) };
  }

  /**
   * The newest discovery result per management address on the observed device's Site, in subnets the caller may
   * read. Added to each LLDP/CDP observation as `discoveryCandidate` (null when there is none).
   */
  async withDiscoveryCandidates<T extends { deviceId: string; managementAddress: string | null }>(user: AuthenticatedUser, observations: T[]) {
    const addresses = [...new Set(observations.flatMap((item) => (item.managementAddress ? [item.managementAddress] : [])))];
    const deviceIds = [...new Set(observations.map((item) => item.deviceId))];
    if (!addresses.length) return observations.map((item) => ({ ...item, discoveryCandidate: null }));
    const devices = await this.prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, siteId: true } });
    const siteByDevice = new Map(devices.map((item) => [item.id, item.siteId]));
    const siteIds = [...new Set(devices.flatMap((item) => (item.siteId ? [item.siteId] : [])))];
    if (!siteIds.length) return observations.map((item) => ({ ...item, discoveryCandidate: null }));
    const rows = await this.prisma.discoveryResult.findMany({
      where: { address: { in: addresses }, job: { subnet: { AND: [await this.ipam.whereFor(user, 'READ', 'subnet'), { siteId: { in: siteIds } }] } } },
      select: { id: true, jobId: true, address: true, status: true, hostname: true, icmpReachable: true, createdAt: true, job: { select: { subnetId: true, subnet: { select: { siteId: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 2000,
    });
    const newest = new Map<string, (typeof rows)[number]>();
    for (const item of rows) {
      const key = `${item.job.subnet.siteId}|${item.address}`;
      if (!newest.has(key)) newest.set(key, item);
    }
    return observations.map((item) => {
      const found = item.managementAddress ? newest.get(`${siteByDevice.get(item.deviceId)}|${item.managementAddress}`) : undefined;
      return { ...item, discoveryCandidate: found ? { resultId: found.id, jobId: found.jobId, subnetId: found.job.subnetId, status: found.status, hostname: found.hostname, icmpReachable: found.icmpReachable, discoveredAt: found.createdAt } : null };
    });
  }
}
