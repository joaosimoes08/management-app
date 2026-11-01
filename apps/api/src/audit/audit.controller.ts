import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit') @ApiBearerAuth() @Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}
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
}
