import { BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import { auditCsv, decodeAuditCursor, deriveAuditDiff, encodeAuditCursor } from './audit-query';

export type AuditPageFilters = { limit?: number; cursor?: string; q?: string; action?: string; entityType?: string; entityId?: string; actorId?: string; user?: string; from?: string; to?: string; excludeHttp?: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AUDIT_EXPORT_LIMIT = 10_000;
const FACET_LIMIT = 500;
/** Facets without from/to cover this many days, so the dropdown counts never scan the whole table. */
export const AUDIT_FACET_DEFAULT_DAYS = 90;

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly maintenance = new Queue('maintenance', { connection: this.redisConnection() });
  constructor(private readonly prisma: PrismaClient) {}
  private redisConnection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1000, maxRetriesPerRequest: 1, ...(url.password ? { password: url.password } : {}) }; }
  async onModuleDestroy() { await this.maintenance.disconnect(); }
  list(filters: { limit?: number; search?: string; action?: string; entityType?: string; user?: string; from?: string; to?: string } = {}) {
    const term = (value?: string) => value?.trim().slice(0, 120) || undefined;
    const from = filters.from && Number.isFinite(Date.parse(filters.from)) ? new Date(filters.from) : undefined;
    const to = filters.to && Number.isFinite(Date.parse(filters.to)) ? new Date(filters.to) : undefined;
    return this.prisma.auditLog.findMany({
      take: Math.min(Math.max(filters.limit ?? 100, 1), 200), orderBy: { createdAt: 'desc' },
      where: {
        ...(term(filters.action) ? { action: { contains: term(filters.action), mode: 'insensitive' as const } } : {}),
        ...(term(filters.entityType) ? { entityType: { contains: term(filters.entityType), mode: 'insensitive' as const } } : {}),
        ...(term(filters.user) ? { user: { is: { OR: [{ username: { contains: term(filters.user), mode: 'insensitive' as const } }, { displayName: { contains: term(filters.user), mode: 'insensitive' as const } }] } } } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(term(filters.search) ? { OR: [
          { action: { contains: term(filters.search), mode: 'insensitive' as const } },
          { entityType: { contains: term(filters.search), mode: 'insensitive' as const } },
          { entityId: { contains: term(filters.search), mode: 'insensitive' as const } },
          { user: { is: { OR: [{ username: { contains: term(filters.search), mode: 'insensitive' as const } }, { displayName: { contains: term(filters.search), mode: 'insensitive' as const } }] } } },
        ] } : {}),
      },
      include: { user: { select: { username: true, displayName: true } } },
    });
  }
  private pageWhere(filters: AuditPageFilters): Prisma.AuditLogWhereInput {
    const term = (value?: string) => value?.trim().slice(0, 120) || undefined;
    const date = (value: string | undefined, name: string) => {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) throw new BadRequestException({ code: 'AUDIT_FILTER_INVALID', message: `Data inválida em ${name}.` });
      return parsed;
    };
    const from = date(filters.from, 'from'); const to = date(filters.to, 'to');
    if (from && to && from > to) throw new BadRequestException({ code: 'AUDIT_FILTER_INVALID', message: 'O início do intervalo tem de ser anterior ao fim.' });
    if (filters.actorId && !UUID.test(filters.actorId)) throw new BadRequestException({ code: 'AUDIT_FILTER_INVALID', message: 'actorId inválido.' });
    const q = term(filters.q); const user = term(filters.user);
    const insensitive = 'insensitive' as const;
    const and: Prisma.AuditLogWhereInput[] = [];
    if (term(filters.action)) and.push({ action: term(filters.action) });
    if (term(filters.entityType)) and.push({ entityType: term(filters.entityType) });
    if (term(filters.entityId)) and.push({ entityId: term(filters.entityId) });
    if (filters.actorId) and.push({ userId: filters.actorId });
    if (filters.excludeHttp) and.push({ OR: [{ entityType: null }, { entityType: { not: 'HTTP_REQUEST' } }] });
    if (user) and.push({ user: { is: { OR: [{ username: { contains: user, mode: insensitive } }, { displayName: { contains: user, mode: insensitive } }] } } });
    if (from || to) and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    if (q) and.push({ OR: [
      { action: { contains: q, mode: insensitive } },
      { entityType: { contains: q, mode: insensitive } },
      { entityId: { contains: q, mode: insensitive } },
      { ipAddress: { contains: q, mode: insensitive } },
      { user: { is: { OR: [{ username: { contains: q, mode: insensitive } }, { displayName: { contains: q, mode: insensitive } }] } } },
    ] });
    return and.length ? { AND: and } : {};
  }
  /** Cursor-paged audit events in a stable (createdAt desc, id desc) order, with any stored before/after exposed as `diff`. */
  async page(filters: AuditPageFilters = {}) {
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50) || 50, 1), 200);
    const cursor = decodeAuditCursor(filters.cursor);
    const base = this.pageWhere(filters);
    const where: Prisma.AuditLogWhereInput = cursor ? { AND: [base, { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : base;
    const rows = await this.prisma.auditLog.findMany({ where, take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { user: { select: { id: true, username: true, displayName: true } } } });
    const hasMore = rows.length > limit; const items = rows.slice(0, limit);
    return {
      items: items.map((row) => { const diff = deriveAuditDiff(row.metadata); return { ...row, diff, hasDiff: Boolean(diff?.length) }; }),
      nextCursor: hasMore ? encodeAuditCursor(items[items.length - 1]) : null,
      hasMore,
      limit,
    };
  }
  /** Distinct values for the filter dropdowns. HTTP request actions (one per URL) are folded into entityType HTTP_REQUEST. */
  async facets(filters: { from?: string; to?: string } = {}) {
    const from = filters.from ?? (filters.to ? undefined : new Date(Date.now() - AUDIT_FACET_DEFAULT_DAYS * 86_400_000).toISOString());
    const window = this.pageWhere({ from, to: filters.to });
    const [actions, entityTypes, actors] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], where: { AND: [window, { OR: [{ entityType: null }, { entityType: { not: 'HTTP_REQUEST' } }] }] }, _count: { _all: true }, orderBy: { action: 'asc' }, take: FACET_LIMIT }),
      this.prisma.auditLog.groupBy({ by: ['entityType'], where: { AND: [window, { entityType: { not: null } }] }, _count: { _all: true }, orderBy: { entityType: 'asc' }, take: FACET_LIMIT }),
      this.prisma.auditLog.groupBy({ by: ['userId'], where: { AND: [window, { userId: { not: null } }] }, _count: { _all: true }, orderBy: { userId: 'asc' }, take: FACET_LIMIT }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: actors.map((item) => item.userId!).filter(Boolean) } }, select: { id: true, username: true, displayName: true } });
    const userById = new Map(users.map((item) => [item.id, item]));
    return {
      actions: actions.map((item) => ({ value: item.action, count: item._count._all })),
      entityTypes: entityTypes.map((item) => ({ value: item.entityType!, count: item._count._all })),
      actors: actors.flatMap((item) => { const found = userById.get(item.userId!); return found ? [{ id: found.id, username: found.username, displayName: found.displayName, count: item._count._all }] : []; }).sort((a, b) => a.username.localeCompare(b.username)),
      from: from ?? null, to: filters.to ?? null,
      truncated: actions.length >= FACET_LIMIT || entityTypes.length >= FACET_LIMIT || actors.length >= FACET_LIMIT,
    };
  }
  /** CSV of the filtered events (same filters as page, no cursor), capped at AUDIT_EXPORT_LIMIT rows. */
  async exportCsv(filters: AuditPageFilters = {}) {
    const rows = await this.prisma.auditLog.findMany({ where: this.pageWhere(filters), take: AUDIT_EXPORT_LIMIT + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { user: { select: { username: true, displayName: true } } } });
    return { csv: auditCsv(rows.slice(0, AUDIT_EXPORT_LIMIT)), truncated: rows.length > AUDIT_EXPORT_LIMIT, rowCount: Math.min(rows.length, AUDIT_EXPORT_LIMIT) };
  }
  async record(input: { userId?: string; action: string; entityType?: string; entityId?: string; metadata?: unknown; ipAddress?: string }) {
    const entry = await this.prisma.auditLog.create({ data: { ...input, metadata: input.metadata as object | undefined } });
    await this.scheduleInventoryQualityReconcile(input.entityType);
    return entry;
  }
  async recordInTransaction(tx: Prisma.TransactionClient, input: { userId?: string; action: string; entityType?: string; entityId?: string; metadata?: unknown; ipAddress?: string }) {
    return tx.auditLog.create({ data: { ...input, metadata: input.metadata as object | undefined } });
  }
  async scheduleInventoryQualityReconcile(entityType?: string) {
    if (['Device', 'DeviceInterface', 'DeviceModel', 'SnmpDrift', 'SnmpSnapshot', 'IpAddress', 'Subnet'].includes(entityType ?? '')) {
      await this.maintenance.add('inventory-quality-reconcile', {}, { delay: 2_000, jobId: 'inventory-quality-reconcile-global', removeOnComplete: true, removeOnFail: 100 }).catch(() => undefined);
    }
  }
}
