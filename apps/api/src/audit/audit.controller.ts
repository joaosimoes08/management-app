import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AuditPageFilters, AuditService } from './audit.service';

type AuditPageQuery = { limit?: string; cursor?: string; q?: string; search?: string; action?: string; entityType?: string; entityId?: string; actorId?: string; user?: string; from?: string; to?: string; excludeHttp?: string };
const pageFilters = (query: AuditPageQuery): AuditPageFilters => ({
  limit: query.limit ? Number(query.limit) : undefined,
  cursor: query.cursor,
  q: query.q ?? query.search,
  action: query.action,
  entityType: query.entityType,
  entityId: query.entityId,
  actorId: query.actorId,
  user: query.user,
  from: query.from,
  to: query.to,
  excludeHttp: query.excludeHttp === 'true' || query.excludeHttp === '1',
});

@ApiTags('audit') @ApiBearerAuth() @Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  /** Legacy list (array, max 200, substring filters). Kept unchanged for existing clients. */
  @Get('events') @Roles('ADMIN', 'AUDITOR') events(
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('user') user?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.audit.list({ limit: Math.min(Math.max(Number(limit) || 100, 1), 200), search, action, entityType, user, from, to });
  }
  /** Cursor-paged list with exact-match dropdown filters and before/after diff. */
  @Get('events/page') @Roles('ADMIN', 'AUDITOR') page(@Query() query: AuditPageQuery) {
    return this.audit.page(pageFilters(query));
  }
  @Get('events/export') @Roles('ADMIN', 'AUDITOR') async export(@Query() query: AuditPageQuery, @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown; type: (value: string) => unknown }) {
    const { cursor: _ignored, ...rest } = query;
    const result = await this.audit.exportCsv(pageFilters(rest));
    reply.type('text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit-events-${new Date().toISOString().slice(0, 10)}.csv"`);
    reply.header('X-Export-Row-Count', String(result.rowCount));
    reply.header('X-Export-Truncated', String(result.truncated));
    return result.csv;
  }
  @Get('facets') @Roles('ADMIN', 'AUDITOR') facets(@Query('from') from?: string, @Query('to') to?: string) {
    return this.audit.facets({ from, to });
  }
}
