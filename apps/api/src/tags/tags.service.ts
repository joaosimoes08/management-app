import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { isUuid, normalizeTagColor, normalizeTagIds, normalizeTagName, TagSummary } from './tag-rules';

type CatalogAction = 'READ' | 'UPDATE';

/**
 * Step 36 — site-scoped tags for devices and subnets.
 * The catalog of a Site is readable by anyone who can read the Site's devices or its IPAM, and editable by
 * anyone who can update either (the controller limits writes to ADMIN and the operator roles). Assigning tags
 * needs UPDATE on that device or subnet. Every change is audited.
 */
@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly infrastructure: InfrastructureAccessService,
    private readonly ipam: IpamAccessService,
  ) {}

  /** Passes when the infrastructure scope or the IPAM scope of the Site allows the action; otherwise rethrows the infrastructure error. */
  private async assertCatalog(user: AuthenticatedUser, action: CatalogAction, siteId: string) {
    try {
      await this.infrastructure.assertSite(user, action, siteId, 'DEVICE');
    } catch (infrastructureError) {
      try { await this.ipam.assertSite(user, action, siteId); } catch { throw infrastructureError; }
    }
  }

  private async tagOrThrow(id: string) {
    if (!isUuid(id)) throw new NotFoundException({ code: 'TAG_NOT_FOUND', message: 'Etiqueta não encontrada.' });
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException({ code: 'TAG_NOT_FOUND', message: 'Etiqueta não encontrada.' });
    return tag;
  }

  private async assertNameFree(siteId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.tag.findFirst({ where: { siteId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictException({ code: 'TAG_NAME_TAKEN', message: `Já existe a etiqueta "${name}" neste Site.` });
  }

  async list(user: AuthenticatedUser, siteId: string | undefined) {
    if (!isUuid(siteId)) throw new BadRequestException({ code: 'TAG_SITE_REQUIRED', message: 'Indica o Site (siteId).' });
    await this.assertCatalog(user, 'READ', siteId);
    const tags = await this.prisma.tag.findMany({ where: { siteId }, include: { _count: { select: { devices: true, subnets: true } } }, orderBy: { name: 'asc' } });
    return tags.map(({ _count, ...tag }) => ({ ...tag, deviceCount: _count.devices, subnetCount: _count.subnets }));
  }

  async create(user: AuthenticatedUser, input: { siteId?: unknown; name?: unknown; color?: unknown }) {
    if (!isUuid(input?.siteId)) throw new BadRequestException({ code: 'TAG_SITE_REQUIRED', message: 'Indica o Site (siteId).' });
    const siteId = input.siteId;
    const name = normalizeTagName(input.name);
    const color = normalizeTagColor(input.color);
    await this.assertCatalog(user, 'UPDATE', siteId);
    await this.assertNameFree(siteId, name);
    const tag = await this.prisma.tag.create({ data: { siteId, name, color } }).catch(() => { throw new ConflictException({ code: 'TAG_NAME_TAKEN', message: `Já existe a etiqueta "${name}" neste Site.` }); });
    await this.audit.record({ userId: user.id, action: 'TAG_CREATED', entityType: 'Tag', entityId: tag.id, metadata: { siteId, name, color } });
    return { ...tag, deviceCount: 0, subnetCount: 0 };
  }

  async update(user: AuthenticatedUser, id: string, input: { name?: unknown; color?: unknown }) {
    const current = await this.tagOrThrow(id);
    await this.assertCatalog(user, 'UPDATE', current.siteId);
    const name = input?.name === undefined ? current.name : normalizeTagName(input.name);
    const color = input?.color === undefined ? (current.color as ReturnType<typeof normalizeTagColor>) : normalizeTagColor(input.color, current.color as never);
    if (name !== current.name) await this.assertNameFree(current.siteId, name, id);
    if (name === current.name && color === current.color) return this.withCounts(current.id);
    await this.prisma.tag.update({ where: { id }, data: { name, color } }).catch(() => { throw new ConflictException({ code: 'TAG_NAME_TAKEN', message: `Já existe a etiqueta "${name}" neste Site.` }); });
    await this.audit.record({ userId: user.id, action: 'TAG_UPDATED', entityType: 'Tag', entityId: id, metadata: { siteId: current.siteId, before: { name: current.name, color: current.color }, after: { name, color } } });
    return this.withCounts(id);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const current = await this.tagOrThrow(id);
    await this.assertCatalog(user, 'UPDATE', current.siteId);
    const [devices, subnets] = await Promise.all([this.prisma.deviceTag.count({ where: { tagId: id } }), this.prisma.subnetTag.count({ where: { tagId: id } })]);
    await this.prisma.tag.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'TAG_DELETED', entityType: 'Tag', entityId: id, metadata: { siteId: current.siteId, name: current.name, removedFromDevices: devices, removedFromSubnets: subnets } });
    return { success: true };
  }

  async setDeviceTags(user: AuthenticatedUser, deviceId: string, tagIdsInput: unknown) {
    const tagIds = normalizeTagIds(tagIdsInput);
    const device = await this.infrastructure.assertDevice(user, 'UPDATE', deviceId);
    const siteId = await this.deviceSiteId(deviceId, device.siteId);
    const tags = await this.siteTags(siteId, tagIds);
    const current = await this.prisma.deviceTag.findMany({ where: { deviceId }, select: { tagId: true, tag: { select: { name: true } } } });
    const { added, removed } = diff(current.map((row) => ({ id: row.tagId, name: row.tag.name })), tags);
    if (added.length || removed.length) {
      await this.prisma.$transaction(async (tx) => {
        if (removed.length) await tx.deviceTag.deleteMany({ where: { deviceId, tagId: { in: removed.map((tag) => tag.id) } } });
        if (added.length) await tx.deviceTag.createMany({ data: added.map((tag) => ({ deviceId, tagId: tag.id })), skipDuplicates: true });
        await this.audit.recordInTransaction(tx, { userId: user.id, action: 'DEVICE_TAGS_UPDATED', entityType: 'Device', entityId: deviceId, metadata: { siteId, added: added.map((tag) => tag.name), removed: removed.map((tag) => tag.name) } });
      });
    }
    return { deviceId, tags: sortTags(tags) };
  }

  async setSubnetTags(user: AuthenticatedUser, subnetId: string, tagIdsInput: unknown) {
    const tagIds = normalizeTagIds(tagIdsInput);
    const subnet = await this.ipam.assertSubnet(user, 'UPDATE', subnetId);
    if (!subnet.siteId) throw new BadRequestException({ code: 'TAG_SUBNET_WITHOUT_SITE', message: 'Associa a subnet a um Site antes de lhe dar etiquetas.' });
    const tags = await this.siteTags(subnet.siteId, tagIds);
    const current = await this.prisma.subnetTag.findMany({ where: { subnetId }, select: { tagId: true, tag: { select: { name: true } } } });
    const { added, removed } = diff(current.map((row) => ({ id: row.tagId, name: row.tag.name })), tags);
    if (added.length || removed.length) {
      await this.prisma.$transaction(async (tx) => {
        if (removed.length) await tx.subnetTag.deleteMany({ where: { subnetId, tagId: { in: removed.map((tag) => tag.id) } } });
        if (added.length) await tx.subnetTag.createMany({ data: added.map((tag) => ({ subnetId, tagId: tag.id })), skipDuplicates: true });
        await this.audit.recordInTransaction(tx, { userId: user.id, action: 'SUBNET_TAGS_UPDATED', entityType: 'Subnet', entityId: subnetId, metadata: { siteId: subnet.siteId, added: added.map((tag) => tag.name), removed: removed.map((tag) => tag.name) } });
      });
    }
    return { subnetId, tags: sortTags(tags) };
  }

  /** A racked device's Site comes from its rack; an unracked one from its own siteId. */
  private async deviceSiteId(deviceId: string, ownSiteId: string | null) {
    const row = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { rack: { select: { room: { select: { building: { select: { siteId: true } } } } } } } });
    const siteId = row?.rack?.room.building.siteId ?? ownSiteId;
    if (!siteId) throw new BadRequestException({ code: 'TAG_DEVICE_WITHOUT_SITE', message: 'Associa o equipamento a um Site antes de lhe dar etiquetas.' });
    return siteId;
  }

  /** The requested tags, which must all exist and belong to the Site. */
  private async siteTags(siteId: string, ids: string[]): Promise<TagSummary[]> {
    if (!ids.length) return [];
    const tags = await this.prisma.tag.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true, siteId: true } });
    if (tags.length !== ids.length) throw new BadRequestException({ code: 'TAG_NOT_FOUND', message: 'Uma ou mais etiquetas não existem.' });
    if (tags.some((tag) => tag.siteId !== siteId)) throw new BadRequestException({ code: 'TAG_SITE_MISMATCH', message: 'As etiquetas têm de pertencer ao Site do item.' });
    return tags.map(({ siteId: _siteId, ...tag }) => tag);
  }

  private async withCounts(id: string) {
    const tag = await this.prisma.tag.findUniqueOrThrow({ where: { id }, include: { _count: { select: { devices: true, subnets: true } } } });
    const { _count, ...rest } = tag;
    return { ...rest, deviceCount: _count.devices, subnetCount: _count.subnets };
  }
}

function diff(current: Array<{ id: string; name: string }>, next: TagSummary[]) {
  const currentIds = new Set(current.map((tag) => tag.id));
  const nextIds = new Set(next.map((tag) => tag.id));
  return { added: next.filter((tag) => !currentIds.has(tag.id)), removed: current.filter((tag) => !nextIds.has(tag.id)) };
}

const sortTags = (tags: TagSummary[]) => [...tags].sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }));
