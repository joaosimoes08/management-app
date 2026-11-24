import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { DiscoveryIdentity, identityHints, IdentityDevice, matchIdentity } from './discovery-identity';

/**
 * Discovery D-P1c read side: identity candidates for the results of one discovery job. Read-only and suggestion-only:
 * it never links, merges or changes anything. Candidate devices the caller may not read are left out entirely, so a
 * suggestion never reveals a device outside the caller's scope (not even that one exists).
 */
@Injectable()
export class DiscoveryIdentityService {
  constructor(private readonly prisma: PrismaClient, private readonly infrastructure: InfrastructureAccessService) {}

  /** Identity per result id. One device query for the whole job, then one scope check per distinct candidate device. */
  async forResults(user: AuthenticatedUser, results: { id: string; address: string; snmp: unknown }[]): Promise<Map<string, DiscoveryIdentity>> {
    const hints = results.map((result) => ({ id: result.id, hints: identityHints(result) }));
    const addresses = [...new Set(hints.map((item) => item.hints.address))];
    const serials = [...new Set(hints.flatMap((item) => (item.hints.serial ? [item.hints.serial] : [])))];
    const names = [...new Set(hints.flatMap((item) => (item.hints.sysName ? [item.hints.sysName] : [])))];
    const devices = results.length ? await this.candidateDevices(addresses, serials, names) : [];
    const readable = await this.readableDevices(user, devices.map((device) => device.id));
    const visible = devices.filter((device) => readable.has(device.id));
    return new Map(hints.map((item) => [item.id, matchIdentity(item.hints, visible)]));
  }

  /** Devices that share an address, a serial or a host name (first DNS label, case-insensitive) with any result. */
  private candidateDevices(addresses: string[], serials: string[], names: string[]) {
    return this.prisma.$queryRaw<IdentityDevice[]>(Prisma.sql`
      SELECT "id"::text AS "id", "name", "hostname", "managementIp", "serialNumber", "siteId"::text AS "siteId", "status"::text AS "status"
      FROM "Device"
      WHERE btrim("managementIp") = ANY(${addresses}::text[])
         OR upper(btrim("serialNumber")) = ANY(${serials}::text[])
         OR lower(split_part(btrim(coalesce("hostname", '')), '.', 1)) = ANY(${names}::text[])
         OR lower(split_part(btrim("name"), '.', 1)) = ANY(${names}::text[])
      ORDER BY "id"
      LIMIT 2000`);
  }

  /** The subset of `ids` the caller may read (same rules as assertDevice READ, batched: a fixed number of queries). */
  private readableDevices(user: AuthenticatedUser, ids: Iterable<string>) {
    return this.infrastructure.readableDeviceIds(user, ids);
  }
}
