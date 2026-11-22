import { Prisma, PrismaClient } from '@simoes/database';

/**
 * Round 2 #6/#14: drift between the IPAM state of an address and what discovery scans saw.
 *
 * A discovery job stores a result only for addresses that answered (ICMP or a TCP port), so "seen" means
 * "has a DiscoveryResult in a COMPLETED scan of its subnet". Both rules only compare an address with scans that
 * started after the record last changed (`IpAddress.updatedAt`), so a record edited after the last scan is never flagged.
 *
 * Only full scans count as coverage: a scan that stopped at a limit ends COMPLETED with a `stopReason`
 * (LIMIT_DURATION / LIMIT_PROBES) and never reached part of its subnet, so it can neither be the "latest scan" nor make an
 * address "Desaparecido". An address that did answer in a partial scan still counts as seen (that answer is real).
 *
 * - FREE but reachable: the address is FREE and answered in the subnet's latest COMPLETED scan of the last 7 days.
 * - OCCUPIED not seen ("Desaparecidos"): the address is OCCUPIED, its subnet had a COMPLETED scan in the last 30 days
 *   that started after the record changed, it answered in none of those scans, and `lastSeenAt` is empty or older than 30 days.
 */
export const FREE_REACHABLE_WINDOW_DAYS = 7;
export const MISSING_WINDOW_DAYS = 30;
const DAY = 86_400_000;

export type FreeButReachableRow = { ipId: string; address: string; subnetId: string; cidr: string; siteId: string | null; hostname: string | null; jobId: string; scanAt: Date };
export type MissingIpRow = { ipId: string; address: string; subnetId: string; cidr: string; siteId: string | null; hostname: string | null; lastSeenAt: Date | null; lastScanAt: Date; scanCount: number };

/** `subnetIds` null means every subnet; an empty array means none. */
function subnetFilter(column: Prisma.Sql, subnetIds: string[] | null) {
  return subnetIds === null ? Prisma.empty : Prisma.sql`AND ${column} = ANY(${subnetIds}::uuid[])`;
}

export async function findFreeButReachable(prisma: PrismaClient, options: { siteId?: string; subnetIds?: string[] | null; now?: Date } = {}): Promise<FreeButReachableRow[]> {
  const subnetIds = options.subnetIds ?? null;
  if (subnetIds && !subnetIds.length) return [];
  const since = new Date((options.now ?? new Date()).getTime() - FREE_REACHABLE_WINDOW_DAYS * DAY);
  return prisma.$queryRaw<FreeButReachableRow[]>(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (j."subnetId") j."id", j."subnetId", COALESCE(j."startedAt", j."createdAt") AS "startedAt", j."completedAt"
      FROM "DiscoveryJob" j
      WHERE j."status" = 'COMPLETED' AND j."stopReason" IS NULL AND j."completedAt" >= ${since} ${subnetFilter(Prisma.sql`j."subnetId"`, subnetIds)}
      ORDER BY j."subnetId", j."completedAt" DESC
    )
    SELECT ip."id" AS "ipId", ip."address", ip."subnetId", s."cidr", s."siteId", COALESCE(r."hostname", ip."hostname") AS "hostname", l."id" AS "jobId", l."completedAt" AS "scanAt"
    FROM latest l
    JOIN "Subnet" s ON s."id" = l."subnetId"
    JOIN "DiscoveryResult" r ON r."jobId" = l."id"
    JOIN "IpAddress" ip ON ip."subnetId" = l."subnetId" AND ip."address" = r."address"
    WHERE ip."state" = 'FREE' AND ip."updatedAt" < l."startedAt" ${options.siteId ? Prisma.sql`AND s."siteId" = ${options.siteId}::uuid` : Prisma.empty}
    ORDER BY s."cidr", ip."address"`);
}

export async function findMissingIps(prisma: PrismaClient, options: { siteId?: string; subnetIds?: string[] | null; ipIds?: string[]; now?: Date } = {}): Promise<MissingIpRow[]> {
  const subnetIds = options.subnetIds ?? null;
  if (subnetIds && !subnetIds.length) return [];
  if (options.ipIds && !options.ipIds.length) return [];
  const since = new Date((options.now ?? new Date()).getTime() - MISSING_WINDOW_DAYS * DAY);
  const rows = await prisma.$queryRaw<Array<MissingIpRow & { scanCount: bigint | number }>>(Prisma.sql`
    SELECT ip."id" AS "ipId", ip."address", ip."subnetId", s."cidr", s."siteId", ip."hostname", ip."lastSeenAt",
           max(j."completedAt") AS "lastScanAt", count(j."id") AS "scanCount"
    FROM "IpAddress" ip
    JOIN "Subnet" s ON s."id" = ip."subnetId"
    JOIN "DiscoveryJob" j ON j."subnetId" = ip."subnetId" AND j."status" = 'COMPLETED' AND j."stopReason" IS NULL AND j."completedAt" >= ${since}
      AND COALESCE(j."startedAt", j."createdAt") > ip."updatedAt"
    WHERE ip."state" = 'OCCUPIED'
      AND (ip."lastSeenAt" IS NULL OR ip."lastSeenAt" < ${since})
      ${subnetFilter(Prisma.sql`ip."subnetId"`, subnetIds)}
      ${options.siteId ? Prisma.sql`AND s."siteId" = ${options.siteId}::uuid` : Prisma.empty}
      ${options.ipIds ? Prisma.sql`AND ip."id" = ANY(${options.ipIds}::uuid[])` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM "DiscoveryResult" r JOIN "DiscoveryJob" seen ON seen."id" = r."jobId"
        WHERE seen."subnetId" = ip."subnetId" AND seen."status" = 'COMPLETED' AND seen."completedAt" >= ${since} AND r."address" = ip."address"
      )
    GROUP BY ip."id", s."id"
    ORDER BY s."cidr", ip."address"`);
  return rows.map((row) => ({ ...row, scanCount: Number(row.scanCount) }));
}
