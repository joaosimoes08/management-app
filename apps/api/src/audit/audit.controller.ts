import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit') @ApiBearerAuth() @Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get('events') @Roles('ADMIN', 'AUDITOR') events(@Query('limit') limit?: string) { return this.audit.list(Math.min(Math.max(Number(limit) || 50, 1), 200)); }
}
