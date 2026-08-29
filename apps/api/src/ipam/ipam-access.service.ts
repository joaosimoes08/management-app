import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';

export type IpamAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'DISCOVER' | 'IMPORT';
type Context = { siteId?: string | null; vrfId?: string | null; vlanId?: string | null; subnetId?: string | null };
type SiteGrant = { siteId: string; permission: string };

@Injectable()
export class IpamAccessService {
  constructor(private readonly prisma: PrismaClient) {}

  private hasCapability(user: AuthenticatedUser, action: IpamAction) {
    if (user.roles.includes('ADMIN')) return true;
    if (action === 'READ') return user.roles.some((role) => role === 'NETWORK_OPERATOR' || role === 'AUDITOR' || role === 'READ_ONLY');
    return user.roles.includes('NETWORK_OPERATOR');
  }

  private async grants(user: AuthenticatedUser): Promise<SiteGrant[] | null> {
    if (user.roles.includes('ADMIN')) return null;
    if (!user.roles.length) return [];
    const memberships = await this.prisma.accessGroupMember.findMany({
      where: { userId: user.id },
      include: { group: { include: { siteAssignments: { include: { permissions: true } } } } },
    });
    return memberships.flatMap((membership) => membership.group.siteAssignments.flatMap((assignment) => [
      { siteId: assignment.siteId, permission: 'SITE_MEMBERSHIP' },
      ...assignment.permissions.map((permission) => ({ siteId: assignment.siteId, permission: permission.permission })),
    ]));
  }

  private siteIds(grants: SiteGrant[], action: IpamAction) {
    return [...new Set(grants.filter((grant) => (action === 'READ' && grant.permission !== 'SITE_MEMBERSHIP') || grant.permission === action).map((grant) => grant.siteId))];
  }

  async assertContext(user: AuthenticatedUser, action: IpamAction, context: Context) {
    const grants = await this.grants(user);
    if (!grants) return;
    if (this.hasCapability(user, action) && context.siteId && this.siteIds(grants, action).includes(context.siteId)) return;
    const visible = this.hasCapability(user, 'READ') && Boolean(context.siteId && this.siteIds(grants, 'READ').includes(context.siteId));
    if (!visible) throw new NotFoundException({ code: 'IPAM_RESOURCE_NOT_FOUND', message: 'Recurso IPAM não encontrado.' });
    throw new ForbiddenException({ code: 'IPAM_SCOPE_FORBIDDEN', message: 'Não tens permissão para esta operação no Site IPAM.' });
  }

  async assertSubnet(user: AuthenticatedUser, action: IpamAction, subnetId: string) {
    const subnet = await this.prisma.subnet.findUnique({ where: { id: subnetId }, select: { id: true, siteId: true, vlanId: true, vrfId: true } });
    if (!subnet) throw new NotFoundException({ code: 'SUBNET_NOT_FOUND', message: 'Subnet não encontrada.' });
    await this.assertContext(user, action, { ...subnet, subnetId: subnet.id }); return subnet;
  }
  async assertVlan(user: AuthenticatedUser, action: IpamAction, vlanId: string) {
    const vlan = await this.prisma.vlan.findUnique({ where: { id: vlanId }, select: { id: true, siteId: true } });
    if (!vlan) throw new NotFoundException({ code: 'VLAN_NOT_FOUND', message: 'VLAN não encontrada.' });
    await this.assertContext(user, action, { siteId: vlan.siteId, vlanId: vlan.id }); return vlan;
  }
  async assertVrf(user: AuthenticatedUser, action: IpamAction, vrfId: string) {
    const vrf = await this.prisma.vrf.findUnique({ where: { id: vrfId }, select: { id: true, siteId: true } });
    if (!vrf) throw new NotFoundException({ code: 'VRF_NOT_FOUND', message: 'VRF não encontrado.' });
    await this.assertContext(user, action, { siteId: vrf.siteId, vrfId: vrf.id }); return vrf;
  }
  async assertSite(user: AuthenticatedUser, action: IpamAction, siteId: string) {
    if (!await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site não encontrado.' });
    await this.assertContext(user, action, { siteId }); return { id: siteId };
  }
  async assertIp(user: AuthenticatedUser, action: IpamAction, ipId: string) {
    const ip = await this.prisma.ipAddress.findUnique({ where: { id: ipId }, include: { subnet: { select: { id: true, siteId: true, vlanId: true, vrfId: true } } } });
    if (!ip) throw new NotFoundException({ code: 'IP_NOT_FOUND', message: 'IP não encontrado.' });
    await this.assertContext(user, action, { ...ip.subnet, subnetId: ip.subnet.id }); return ip;
  }
  async assertHost(user: AuthenticatedUser, action: IpamAction, hostId: string) {
    const host = await this.prisma.host.findUnique({ where: { id: hostId }, include: { ipAddresses: { include: { subnet: { select: { id: true, siteId: true, vlanId: true, vrfId: true } } } } } });
    if (!host) throw new NotFoundException({ code: 'HOST_NOT_FOUND', message: 'Host não encontrado.' });
    if (!host.ipAddresses.length) await this.assertContext(user, action, {});
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
    await this.assertContext(user, action, context); return context;
  }

  async whereFor(user: AuthenticatedUser, action: IpamAction, resource: 'site' | 'vrf' | 'vlan' | 'subnet' | 'ip' | 'host' | 'nat'): Promise<any> {
    const grants = await this.grants(user); if (!grants) return {};
    if (resource === 'site') return { id: { in: [...new Set(grants.map((grant) => grant.siteId))] } };
    const siteIds = this.hasCapability(user, action) ? this.siteIds(grants, action) : [];
    if (resource === 'vrf' || resource === 'vlan' || resource === 'subnet' || resource === 'nat') return { siteId: { in: siteIds } };
    if (resource === 'ip') return { subnet: { siteId: { in: siteIds } } };
    return { ipAddresses: { some: { subnet: { siteId: { in: siteIds } } } } };
  }
}
