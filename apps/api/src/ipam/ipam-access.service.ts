import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';

export type IpamAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'DISCOVER' | 'IMPORT';
type Permission = { scopeType: string; scopeId: string; permission: string };
type Context = { siteId?: string | null; vrfId?: string | null; vlanId?: string | null; subnetId?: string | null };

@Injectable()
export class IpamAccessService {
  constructor(private readonly prisma: PrismaClient) {}

  private async permissions(user: AuthenticatedUser): Promise<Permission[] | null> {
    if (user.roles.includes('ADMIN')) return null;
    const memberships = await this.prisma.ipamGroupMember.findMany({ where: { userId: user.id }, include: { group: { include: { permissions: true } } } });
    const permissions = memberships.flatMap((membership) => membership.group.permissions);
    return permissions.length ? permissions : null;
  }

  private candidates(permissions: Permission[], action: IpamAction) {
    return permissions.filter((entry) => action === 'READ' || entry.permission === action);
  }

  private matches(entry: Permission, context: Context) {
    if (entry.scopeType === 'SITE') return entry.scopeId === context.siteId;
    if (entry.scopeType === 'VRF') return entry.scopeId === context.vrfId;
    if (entry.scopeType === 'VLAN') return entry.scopeId === context.vlanId;
    if (entry.scopeType === 'SUBNET') return entry.scopeId === context.subnetId;
    return false;
  }

  async assertContext(user: AuthenticatedUser, action: IpamAction, context: Context) {
    const permissions = await this.permissions(user);
    if (!permissions) return;
    if (!this.candidates(permissions, action).some((entry) => this.matches(entry, context))) {
      if (action === 'READ') throw new NotFoundException({ code: 'IPAM_RESOURCE_NOT_FOUND', message: 'Recurso IPAM não encontrado.' });
      throw new ForbiddenException({ code: 'IPAM_SCOPE_FORBIDDEN', message: 'Não tens permissão para esta operação no scope IPAM.' });
    }
  }

  async assertSubnet(user: AuthenticatedUser, action: IpamAction, subnetId: string) {
    const subnet = await this.prisma.subnet.findUnique({ where: { id: subnetId }, select: { id: true, siteId: true, vlanId: true, vrfId: true } });
    if (!subnet) throw new NotFoundException({ code: 'SUBNET_NOT_FOUND', message: 'Subnet não encontrada.' });
    await this.assertContext(user, action, { ...subnet, subnetId: subnet.id });
    return subnet;
  }

  async assertVlan(user: AuthenticatedUser, action: IpamAction, vlanId: string) {
    const vlan = await this.prisma.vlan.findUnique({ where: { id: vlanId }, select: { id: true, siteId: true } });
    if (!vlan) throw new NotFoundException({ code: 'VLAN_NOT_FOUND', message: 'VLAN não encontrada.' });
    if (action === 'READ') {
      const visible = await this.prisma.vlan.findFirst({ where: { AND: [{ id: vlanId }, await this.whereFor(user, action, 'vlan')] }, select: { id: true } });
      if (!visible) throw new NotFoundException({ code: 'IPAM_RESOURCE_NOT_FOUND', message: 'Recurso IPAM não encontrado.' });
      return vlan;
    }
    await this.assertContext(user, action, { siteId: vlan.siteId, vlanId: vlan.id });
    return vlan;
  }

  async assertVrf(user: AuthenticatedUser, action: IpamAction, vrfId: string) {
    const vrf = await this.prisma.vrf.findUnique({ where: { id: vrfId }, select: { id: true, siteId: true } });
    if (!vrf) throw new NotFoundException({ code: 'VRF_NOT_FOUND', message: 'VRF não encontrado.' });
    await this.assertContext(user, action, { siteId: vrf.siteId, vrfId: vrf.id });
    return vrf;
  }

  async assertSite(user: AuthenticatedUser, action: IpamAction, siteId: string) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!site) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site não encontrado.' });
    if (action === 'READ') {
      const visible = await this.prisma.site.findFirst({ where: { AND: [{ id: siteId }, await this.whereFor(user, action, 'site')] }, select: { id: true } });
      if (!visible) throw new NotFoundException({ code: 'IPAM_RESOURCE_NOT_FOUND', message: 'Recurso IPAM não encontrado.' });
      return site;
    }
    await this.assertContext(user, action, { siteId });
    return site;
  }

  async assertIp(user: AuthenticatedUser, action: IpamAction, ipId: string) {
    const ip = await this.prisma.ipAddress.findUnique({ where: { id: ipId }, include: { subnet: { select: { id: true, siteId: true, vlanId: true, vrfId: true } } } });
    if (!ip) throw new NotFoundException({ code: 'IP_NOT_FOUND', message: 'IP não encontrado.' });
    await this.assertContext(user, action, { ...ip.subnet, subnetId: ip.subnet.id });
    return ip;
  }

  async assertHost(user: AuthenticatedUser, action: IpamAction, hostId: string) {
    const host = await this.prisma.host.findUnique({ where: { id: hostId }, include: { ipAddresses: { include: { subnet: { select: { id: true, siteId: true, vlanId: true, vrfId: true } } } } } });
    if (!host) throw new NotFoundException({ code: 'HOST_NOT_FOUND', message: 'Host não encontrado.' });
    if (!host.ipAddresses.length) { await this.assertContext(user, action, {}); return host; }
    for (const ip of host.ipAddresses) await this.assertContext(user, action, { ...ip.subnet, subnetId: ip.subnet.id });
    return host;
  }

  async assertSubnetPlacement(user: AuthenticatedUser, action: IpamAction, placement: { siteId?: string | null; vlanId?: string | null; vrfId?: string | null; parentSubnetId?: string | null }) {
    const [site, vlan, vrf, parent] = await Promise.all([
      placement.siteId ? this.prisma.site.findUnique({ where: { id: placement.siteId }, select: { id: true } }) : null,
      placement.vlanId ? this.prisma.vlan.findUnique({ where: { id: placement.vlanId }, select: { id: true, siteId: true } }) : null,
      placement.vrfId ? this.prisma.vrf.findUnique({ where: { id: placement.vrfId }, select: { id: true, siteId: true } }) : null,
      placement.parentSubnetId ? this.prisma.subnet.findUnique({ where: { id: placement.parentSubnetId }, select: { id: true, siteId: true, vlanId: true, vrfId: true } }) : null,
    ]);
    if ((placement.siteId && !site) || (placement.vlanId && !vlan) || (placement.vrfId && !vrf) || (placement.parentSubnetId && !parent)) throw new NotFoundException({ code: 'IPAM_PLACEMENT_NOT_FOUND', message: 'Uma das entidades de contexto da subnet não existe.' });
    const siteIds = [site?.id, vlan?.siteId, vrf?.siteId, parent?.siteId].filter((id): id is string => Boolean(id));
    if (new Set(siteIds).size > 1) throw new BadRequestException({ code: 'IPAM_PLACEMENT_SITE_MISMATCH', message: 'Site, VLAN, VRF e subnet pai têm de pertencer ao mesmo Site.' });
    const context = { siteId: siteIds[0] ?? null, vlanId: vlan?.id ?? parent?.vlanId, vrfId: vrf?.id ?? parent?.vrfId, subnetId: parent?.id };
    await this.assertContext(user, action, context);
    return context;
  }

  async whereFor(user: AuthenticatedUser, action: IpamAction, resource: 'site' | 'vrf' | 'vlan' | 'subnet' | 'ip' | 'host' | 'nat'): Promise<any> {
    const permissions = await this.permissions(user);
    if (!permissions) return {};
    const candidates = this.candidates(permissions, action);
    const siteIds = candidates.filter((p) => p.scopeType === 'SITE').map((p) => p.scopeId);
    const vrfIds = candidates.filter((p) => p.scopeType === 'VRF').map((p) => p.scopeId);
    const vlanIds = candidates.filter((p) => p.scopeType === 'VLAN').map((p) => p.scopeId);
    const subnetIds = candidates.filter((p) => p.scopeType === 'SUBNET').map((p) => p.scopeId);
    if (resource === 'site') return { OR: [{ id: { in: siteIds } }, { vrfs: { some: { id: { in: vrfIds } } } }, { vlans: { some: { id: { in: vlanIds } } } }, { subnets: { some: { OR: [{ id: { in: subnetIds } }, { vrfId: { in: vrfIds } }, { vlanId: { in: vlanIds } }] } } }] };
    if (resource === 'vrf') return { OR: [{ id: { in: vrfIds } }, { siteId: { in: siteIds } }] };
    if (resource === 'vlan') return { OR: [{ id: { in: vlanIds } }, { siteId: { in: siteIds } }, { subnets: { some: { OR: [{ id: { in: subnetIds } }, { vrfId: { in: vrfIds } }] } } }] };
    const subnetWhere = { OR: [{ id: { in: subnetIds } }, { siteId: { in: siteIds } }, { vrfId: { in: vrfIds } }, { vlanId: { in: vlanIds } }] };
    if (resource === 'subnet') return subnetWhere;
    if (resource === 'ip') return { subnet: subnetWhere };
    if (resource === 'nat') return { OR: [{ siteId: { in: siteIds } }, { vrfId: { in: vrfIds } }, { sourceSubnet: subnetWhere }, { translatedSubnet: subnetWhere }] };
    return { ipAddresses: { some: { subnet: subnetWhere } } };
  }
}
