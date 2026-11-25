import { BadRequestException, Injectable } from '@nestjs/common';
import { isIPv4 } from 'node:net';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';

/** Upper bounds on one response (a device's whole table, or one lookup across devices). */
export const DEVICE_ARP_LIMIT = 5_000;
export const DEVICE_MAC_LIMIT = 20_000;
export const LOOKUP_LIMIT = 500;

/** "00:a3:d1:ab:00:31" from colon, dash, dot (Cisco) or bare hex forms; null when it is not a MAC. */
export function parseMac(value: string | undefined): string | null {
  if (!value) return null;
  const hex = value.trim().toLowerCase().replace(/[:\-.]/g, '');
  return /^[0-9a-f]{12}$/.test(hex) ? hex.match(/../g)!.join(':') : null;
}

/**
 * Discovery D-P1e read side: ARP and MAC forwarding sightings stored by the SNMP poller. Read-only and scoped to the
 * devices the caller may read. A sighting says where an address was seen; it is not a Device and is never matched to one.
 * `current` is true when the row came from the device's newest endpoint poll; older rows are kept for 30 days.
 */
@Injectable()
export class SnmpEndpointsService {
  constructor(private readonly prisma: PrismaClient, private readonly infrastructure: InfrastructureAccessService) {}

  /** GET /snmp/devices/:deviceId/endpoints */
  async deviceEndpoints(user: AuthenticatedUser, deviceId: string) {
    await this.infrastructure.assertDevice(user, 'READ', deviceId);
    const [arp, mac] = await Promise.all([
      this.prisma.snmpArpEntry.findMany({ where: { deviceId }, orderBy: [{ lastSeenAt: 'desc' }, { ipAddress: 'asc' }, { macAddress: 'asc' }], take: DEVICE_ARP_LIMIT + 1 }),
      this.prisma.snmpMacEntry.findMany({ where: { deviceId }, orderBy: [{ lastSeenAt: 'desc' }, { vlanId: 'asc' }, { macAddress: 'asc' }], take: DEVICE_MAC_LIMIT + 1 }),
    ]);
    const newest = (rows: { lastSeenAt: Date }[]) => (rows.length ? rows[0].lastSeenAt : null);
    const arpPolledAt = newest(arp), macPolledAt = newest(mac);
    return {
      deviceId,
      arpPolledAt,
      macPolledAt,
      truncated: arp.length > DEVICE_ARP_LIMIT || mac.length > DEVICE_MAC_LIMIT,
      arp: arp.slice(0, DEVICE_ARP_LIMIT).map((row) => this.arpRow(row, arpPolledAt)),
      mac: mac.slice(0, DEVICE_MAC_LIMIT).map((row) => this.macRow(row, macPolledAt)),
    };
  }

  /**
   * GET /snmp/endpoints?mac=…|ip=…: where an address was seen, across the devices the caller may read, newest first.
   * A MAC is looked up in both tables; an IPv4 address in the ARP table (and then its MACs in the forwarding table).
   */
  async lookup(user: AuthenticatedUser, query: { mac?: string; ip?: string }) {
    const mac = parseMac(query.mac);
    const ip = query.ip?.trim();
    if ((query.mac && !mac) || (ip && !isIPv4(ip)) || (!mac && !ip) || (mac && ip)) {
      throw new BadRequestException({ code: 'SNMP_ENDPOINT_QUERY_INVALID', message: 'Indique um endereço MAC ou um endereço IPv4.' });
    }
    const arp = await this.prisma.snmpArpEntry.findMany({ where: mac ? { macAddress: mac } : { ipAddress: ip }, orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }], take: LOOKUP_LIMIT, include: { device: { select: { name: true } } } });
    const macs = mac ? [mac] : [...new Set(arp.map((row) => row.macAddress))];
    const fdb = macs.length ? await this.prisma.snmpMacEntry.findMany({ where: { macAddress: { in: macs } }, orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }], take: LOOKUP_LIMIT, include: { device: { select: { name: true } } } }) : [];
    const readable = await this.readableDevices(user, [...arp, ...fdb].map((row) => row.deviceId));
    const newestByDevice = await this.newestByDevice([...readable]);
    return {
      query: mac ? { mac } : { ip },
      arp: arp.filter((row) => readable.has(row.deviceId)).map((row) => ({ ...this.arpRow(row, newestByDevice.arp.get(row.deviceId) ?? null), deviceName: row.device.name })),
      mac: fdb.filter((row) => readable.has(row.deviceId)).map((row) => ({ ...this.macRow(row, newestByDevice.mac.get(row.deviceId) ?? null), deviceName: row.device.name })),
    };
  }

  private arpRow(row: { id: string; deviceId: string; ipAddress: string; macAddress: string; ifIndex: number | null; interfaceName: string | null; entryType: string; source: string; firstSeenAt: Date; lastSeenAt: Date }, polledAt: Date | null) {
    return { id: row.id, deviceId: row.deviceId, ipAddress: row.ipAddress, macAddress: row.macAddress, ifIndex: row.ifIndex, interfaceName: row.interfaceName, type: row.entryType, source: row.source, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, current: polledAt !== null && row.lastSeenAt.getTime() === polledAt.getTime() };
  }

  private macRow(row: { id: string; deviceId: string; vlanId: number; macAddress: string; bridgePort: number | null; ifIndex: number | null; interfaceName: string | null; status: string; source: string; firstSeenAt: Date; lastSeenAt: Date }, polledAt: Date | null) {
    return { id: row.id, deviceId: row.deviceId, vlanId: row.vlanId > 0 ? row.vlanId : null, macAddress: row.macAddress, bridgePort: row.bridgePort, ifIndex: row.ifIndex, interfaceName: row.interfaceName, status: row.status, source: row.source, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, current: polledAt !== null && row.lastSeenAt.getTime() === polledAt.getTime() };
  }

  private async newestByDevice(deviceIds: string[]) {
    if (!deviceIds.length) return { arp: new Map<string, Date>(), mac: new Map<string, Date>() };
    const [arp, mac] = await Promise.all([
      this.prisma.snmpArpEntry.groupBy({ by: ['deviceId'], where: { deviceId: { in: deviceIds } }, _max: { lastSeenAt: true } }),
      this.prisma.snmpMacEntry.groupBy({ by: ['deviceId'], where: { deviceId: { in: deviceIds } }, _max: { lastSeenAt: true } }),
    ]);
    const map = (rows: { deviceId: string; _max: { lastSeenAt: Date | null } }[]) => new Map(rows.flatMap((row) => (row._max.lastSeenAt ? [[row.deviceId, row._max.lastSeenAt] as const] : [])));
    return { arp: map(arp), mac: map(mac) };
  }

  /** The subset of `ids` the caller may read (same rules as assertDevice READ, batched: a fixed number of queries). */
  private readableDevices(user: AuthenticatedUser, ids: Iterable<string>) {
    return this.infrastructure.readableDeviceIds(user, ids);
  }
}
