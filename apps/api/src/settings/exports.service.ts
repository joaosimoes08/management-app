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

  private async devices(siteId: string | undefined, user: AuthenticatedUser) {
    const roomIds = await this.infrastructureAccess.visibleRoomIds(user, siteId);
    const unplacedSiteIds = await this.infrastructureAccess.visibleUnplacedSiteIds(user, siteId);
    const where = { AND: [{ OR: [{ rackId: null, siteId: { in: unplacedSiteIds } }, { rack: { roomId: { in: roomIds } } }] }, ...(siteId ? [{ siteId }] : [])] };
    return this.prisma.device.findMany({ where, select: Object.fromEntries(FIELDS.devices.map((field) => [field, true])) as never, orderBy: { name: 'asc' }, take: 10000 }) as unknown as Promise<Record<string, unknown>[]>;
  }

  async export(kind: string, format: string, siteId: string | undefined, user: AuthenticatedUser) {
    if (!Object.hasOwn(FIELDS, kind) || !['csv', 'json'].includes(format)) throw new BadRequestException('Export supports devices, subnets, vlans or ips as CSV or JSON.');
    const resource: Record<string, 'ip'|'subnet'|'vlan'> = { ips: 'ip', subnets: 'subnet', vlans: 'vlan' };
    let rows: Record<string, unknown>[];
    if (kind === 'devices') {
      rows = await this.devices(siteId, user);
    } else {
      if (!this.policy.canUseIpam(user, 'READ')) throw new ForbiddenException('IPAM read access is required.');
      const scoped = await this.ipamAccess.whereFor(user, 'READ', resource[kind]);
      const where = { AND: [scoped, ...(siteId ? [kind === 'ips' ? { subnet: { siteId } } : { siteId }] : [])] };
      rows = await (kind === 'ips' ? this.prisma.ipAddress.findMany({ where, select: Object.fromEntries(FIELDS.ips.map((field) => [field, true])) as never, orderBy: { address: 'asc' }, take: 10000 }) : kind === 'subnets' ? this.prisma.subnet.findMany({ where, select: Object.fromEntries(FIELDS.subnets.map((field) => [field, true])) as never, orderBy: { cidr: 'asc' }, take: 10000 }) : this.prisma.vlan.findMany({ where, select: Object.fromEntries(FIELDS.vlans.map((field) => [field, true])) as never, orderBy: { vlanId: 'asc' }, take: 10000 })) as unknown as Record<string, unknown>[];
    }
    await this.audit.record({ userId: user.id, action: 'INVENTORY_EXPORT', entityType: 'InventoryExport', metadata: { kind, format, siteId: siteId ?? null, rowCount: rows.length } });
    return { rows, fields: FIELDS[kind] };
  }

  async ansibleInventory(siteId: string | undefined, user: AuthenticatedUser) {
    const rows = await this.devices(siteId, user);
    const hostvars: Record<string, Record<string, string>> = {};
    const groups = new Map<string, string[]>();
    const usedHosts = new Set<string>();
    for (const row of rows) {
      const name = text(row.hostname) || text(row.name) || text(row.id);
      if (!name) continue;
      const baseHost = slug(name) || 'device';
      let host = baseHost;
      if (usedHosts.has(host)) {
        const suffix = slug(text(row.id)).slice(0, 8) || 'device';
        host = `${baseHost}_${suffix}`;
        let duplicate = 2;
        while (usedHosts.has(host)) host = `${baseHost}_${suffix}_${duplicate++}`;
      }
      usedHosts.add(host);
      const type = slug(text(row.type)) || 'other';
      const group = `device_type_${type}`;
      groups.set(group, [...(groups.get(group) ?? []), host]);
      const vars: Record<string, string> = {};
      const allowed: Array<[string, unknown]> = [
        ['ansible_host', row.managementIp || row.hostname || row.name],
        ['inventory_name', row.name], ['asset_tag', row.assetTag], ['serial_number', row.serialNumber],
        ['device_type', row.type], ['device_status', row.status], ['site_id', row.siteId],
      ];
      for (const [key, value] of allowed) if (typeof value === 'string' && value.trim()) vars[key] = value;
      hostvars[host] = vars;
    }
    const inventory: Record<string, unknown> = { all: { children: [...groups.keys()].sort() } };
    for (const [group, hosts] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) inventory[group] = { hosts: hosts.sort() };
    inventory._meta = { hostvars };
    await this.audit.record({ userId: user.id, action: 'ANSIBLE_INVENTORY_EXPORT', entityType: 'InventoryExport', metadata: { kind: 'ansible', format: 'json', siteId: siteId ?? null, rowCount: Object.keys(hostvars).length } });
    return inventory;
  }
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function slug(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
