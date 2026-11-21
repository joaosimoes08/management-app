import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { CreateApplicationLinkDto } from './dto/create-application-link.dto';
import { UpdateApplicationLinkDto } from './dto/update-application-link.dto';
import { LINK_PROBE_TIMEOUT_MS, LinkProbeOutcome, probeLink } from './link-probe';

/** check-all bounds: at most CHECK_ALL_BATCH links per call, CHECK_ALL_WORKERS at a time, no new probe after CHECK_ALL_BUDGET_MS. */
export const CHECK_ALL_BATCH = 100;
export const CHECK_ALL_WORKERS = 10;
export const CHECK_ALL_BUDGET_MS = 25_000;

@Injectable()
export class ApplicationLinksService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  private visibleWhere(user: AuthenticatedUser) {
    return { isActive: true, OR: [{ roles: { none: {} } }, { roles: { some: { role: { in: user.roles as never[] } } } }] };
  }

  async list(user: AuthenticatedUser, includeInactive = false) {
    const canManage = user.roles.includes('ADMIN');
    const [links, favorites] = await Promise.all([
      this.prisma.applicationLink.findMany({
        where: {
          ...(includeInactive && canManage ? {} : this.visibleWhere(user)),
        },
        include: { roles: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.userApplicationFavorite.findMany({ where: { userId: user.id }, select: { linkId: true } }),
    ]);
    const favoriteIds = new Set(favorites.map((item) => item.linkId));
    return links.map((link) => ({ ...link, isFavorite: favoriteIds.has(link.id) }));
  }

  /** The caller's favourites, in their order, limited to links they can still see. */
  async favorites(user: AuthenticatedUser) {
    const rows = await this.prisma.userApplicationFavorite.findMany({
      where: { userId: user.id, link: this.visibleWhere(user) },
      include: { link: { include: { roles: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map((row) => ({ ...row.link, isFavorite: true, favoriteSortOrder: row.sortOrder, favoritedAt: row.createdAt })) };
  }

  /** Idempotent: marking an existing favourite again only updates its sortOrder when one is sent. */
  async setFavorite(id: string, user: AuthenticatedUser, sortOrder?: number) {
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000)) throw new BadRequestException({ code: 'FAVORITE_SORT_ORDER_INVALID', message: 'sortOrder deve ser um inteiro entre 0 e 10000.' });
    const link = await this.prisma.applicationLink.findFirst({ where: { id, ...this.visibleWhere(user) }, select: { id: true } });
    if (!link) throw new NotFoundException({ code: 'APPLICATION_LINK_NOT_FOUND', message: 'Ligação não encontrada' });
    const order = sortOrder ?? (await this.prisma.userApplicationFavorite.count({ where: { userId: user.id } }));
    const row = await this.prisma.userApplicationFavorite.upsert({
      where: { userId_linkId: { userId: user.id, linkId: id } },
      create: { userId: user.id, linkId: id, sortOrder: order },
      update: sortOrder !== undefined ? { sortOrder } : {},
    });
    return { linkId: id, isFavorite: true, sortOrder: row.sortOrder, createdAt: row.createdAt };
  }

  async removeFavorite(id: string, user: AuthenticatedUser) {
    await this.prisma.userApplicationFavorite.deleteMany({ where: { userId: user.id, linkId: id } });
    return { linkId: id, isFavorite: false };
  }

  async create(dto: CreateApplicationLinkDto, user: AuthenticatedUser) {
    const { roles, ...data } = dto;
    const link = await this.prisma.applicationLink.create({
      data: { ...data, roles: { create: (roles ?? []).map((role) => ({ role: role as never })) } },
      include: { roles: true },
    });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_CREATED', entityType: 'ApplicationLink', entityId: link.id, metadata: { name: link.name } });
    return link;
  }

  async update(id: string, dto: UpdateApplicationLinkDto, user: AuthenticatedUser) {
    const existing = await this.prisma.applicationLink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ligação não encontrada');
    const { roles, ...data } = dto;
    const link = await this.prisma.$transaction(async (tx) => {
      if (roles) await tx.applicationLinkRole.deleteMany({ where: { linkId: id } });
      return tx.applicationLink.update({
        where: { id },
        data: { ...data, ...(roles ? { roles: { create: roles.map((role) => ({ role: role as never })) } } : {}) },
        include: { roles: true },
      });
    });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_UPDATED', entityType: 'ApplicationLink', entityId: link.id, metadata: { name: link.name } });
    return link;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const link = await this.prisma.applicationLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Ligação não encontrada');
    await this.prisma.applicationLink.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_DELETED', entityType: 'ApplicationLink', entityId: id, metadata: { name: link.name } });
  }

  /** Overridable in tests. */
  protected probe(url: string): Promise<LinkProbeOutcome> { return probeLink(url); }

  async check(id: string, user: AuthenticatedUser) {
    const link = await this.prisma.applicationLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Ligação não encontrada');
    const { available } = await this.probe(link.url);
    const updated = await this.prisma.applicationLink.update({ where: { id }, data: { lastCheckedAt: new Date(), isAvailable: available }, include: { roles: true } });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_CHECKED', entityType: 'ApplicationLink', entityId: id, metadata: { available } });
    return updated;
  }

  /**
   * POST application-links/check-all — checks active links with "check availability" on (or every active link
   * with all=true). Up to 100 links per call, from `offset` in a stable order, 10 at a time with a 3 s budget each;
   * no probe starts after 25 s, so a call stays under ~30 s. `nextOffset` is set while links remain.
   * Links that resolve (or redirect) to loopback, private, link-local or CGNAT addresses get `code: 'BLOCKED'`
   * unless APPLICATION_LINK_CHECK_ALLOWED_CIDRS allows them.
   */
  async checkAll(user: AuthenticatedUser, all = false, offsetText?: string, budgetMs = CHECK_ALL_BUDGET_MS) {
    const offset = offsetText === undefined || offsetText === '' ? 0 : Number(offsetText);
    if (!Number.isInteger(offset) || offset < 0) throw new BadRequestException({ code: 'CHECK_ALL_OFFSET_INVALID', message: 'offset tem de ser um inteiro ≥ 0.' });
    const where = { isActive: true, ...(all ? {} : { checkAvailability: true }) };
    const [total, links] = await Promise.all([
      this.prisma.applicationLink.count({ where }),
      this.prisma.applicationLink.findMany({ where, select: { id: true, name: true, url: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }], skip: offset, take: CHECK_ALL_BATCH }),
    ]);
    type Item = { id: string; name: string; available: boolean; httpStatus: number | null; responseMs: number | null; checkedAt: Date; code?: LinkProbeOutcome['code'] };
    const results: Item[] = [];
    const deadline = Date.now() + budgetMs;
    let next = 0;
    const worker = async () => {
      while (next < links.length && Date.now() < deadline) {
        const index = next++;
        const link = links[index];
        const outcome = await this.probe(link.url);
        const checkedAt = new Date();
        await this.prisma.applicationLink.update({ where: { id: link.id }, data: { lastCheckedAt: checkedAt, isAvailable: outcome.available } });
        await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_CHECKED', entityType: 'ApplicationLink', entityId: link.id, metadata: { available: outcome.available, bulk: true, ...(outcome.code ? { code: outcome.code } : {}) } });
        results[index] = { id: link.id, name: link.name, ...outcome, checkedAt };
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_ALL_WORKERS, links.length) }, worker));
    // Probes started in order, so the checked items are a contiguous prefix of this batch.
    const items = results.slice(0, next).filter(Boolean);
    const consumed = offset + items.length;
    const available = items.filter((item) => item.available).length;
    const blocked = items.filter((item) => item.code === 'BLOCKED').length;
    return {
      checked: items.length, available, unavailable: items.length - available, blocked,
      scope: all ? 'ALL_ACTIVE' : 'CHECK_AVAILABILITY', offset, total,
      nextOffset: consumed < total ? consumed : null,
      perLinkTimeoutMs: LINK_PROBE_TIMEOUT_MS,
      items,
    };
  }
}
