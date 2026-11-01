import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { AccessPolicyService } from '../access/access-policy.service';

const FIELDS: Record<string, string[]> = {
  devices: ['id','name','type','serialNumber','assetTag','hostname','managementIp','status','source','siteId','createdAt','updatedAt'],
  subnets: ['id','cidr','version','gateway','purpose','environment','siteId','vlanId','vrfId'],
  vlans: ['id','vlanId','name','description','siteId'],
  ips: ['id','address','state','hostname','macAddress','version','subnetId','deviceId','interfaceId','hostId'],
};

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaClient, private readonly ipamAccess: IpamAccessService, private readonly infrastructureAccess: InfrastructureAccessService, private readonly policy: AccessPolicyService, private readonly audit: AuditService) {}

  async export(kind: string, format: string, siteId: string | undefined, user: AuthenticatedUser) {
    if (!Object.hasOwn(FIELDS, kind) || !['csv', 'json'].includes(format)) throw new BadRequestException('Export supports devices, subnets, vlans or ips as CSV or JSON.');
    const resource: Record<string, 'ip'|'subnet'|'vlan'> = { ips: 'ip', subnets: 'subnet', vlans: 'vlan' };
    let rows: Record<string, unknown>[];
    if (kind === 'devices') {
      const roomIds = await this.infrastructureAccess.visibleRoomIds(user, siteId);
      const unplacedSiteIds = await this.infrastructureAccess.visibleUnplacedSiteIds(user, siteId);
      const where = { AND: [{ OR: [{ rackId: null, siteId: { in: unplacedSiteIds } }, { rack: { roomId: { in: roomIds } } }] }, ...(siteId ? [{ siteId }] : [])] };
      rows = await this.prisma.device.findMany({ where, select: Object.fromEntries(FIELDS.devices.map((field) => [field, true])) as never, orderBy: { name: 'asc' }, take: 10000 }) as unknown as Record<string, unknown>[];
    } else {
      if (!this.policy.canUseIpam(user, 'READ')) throw new ForbiddenException('IPAM read access is required.');
      const scoped = await this.ipamAccess.whereFor(user, 'READ', resource[kind]);
      const where = { AND: [scoped, ...(siteId ? [kind === 'ips' ? { subnet: { siteId } } : { siteId }] : [])] };
      rows = await (kind === 'ips' ? this.prisma.ipAddress.findMany({ where, select: Object.fromEntries(FIELDS.ips.map((field) => [field, true])) as never, orderBy: { address: 'asc' }, take: 10000 }) : kind === 'subnets' ? this.prisma.subnet.findMany({ where, select: Object.fromEntries(FIELDS.subnets.map((field) => [field, true])) as never, orderBy: { cidr: 'asc' }, take: 10000 }) : this.prisma.vlan.findMany({ where, select: Object.fromEntries(FIELDS.vlans.map((field) => [field, true])) as never, orderBy: { vlanId: 'asc' }, take: 10000 })) as unknown as Record<string, unknown>[];
    }
    await this.audit.record({ userId: user.id, action: 'INVENTORY_EXPORT', entityType: 'InventoryExport', metadata: { kind, format, siteId: siteId ?? null, rowCount: rows.length } });
    return { rows, fields: FIELDS[kind] };
  }
}
