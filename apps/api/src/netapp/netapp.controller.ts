import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { UpsertNetAppIntegrationDto } from './dto';
import { NetAppService } from './netapp.service';

@ApiTags('netapp') @ApiBearerAuth() @Controller({ path: 'netapp/sites', version: '1' })
export class NetAppController {
  constructor(private readonly service: NetAppService) {}

  @Put(':siteId/integration') @Roles('ADMIN') configure(@Param('siteId') siteId: string, @Body() dto: UpsertNetAppIntegrationDto, @Req() req: { user: AuthenticatedUser }) {
    return this.service.configure(siteId, dto, req.user);
  }

  @Get(':siteId/trend') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') trend(@Param('siteId') siteId: string, @Query('kind') kind: string | undefined, @Query('key') key: string | undefined, @Query('days') days: string | undefined, @Req() req: { user: AuthenticatedUser }) {
    return this.service.trend(siteId, req.user, { kind, key, days });
  }

  @Get(':siteId/trend/objects') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') trendObjects(@Param('siteId') siteId: string, @Query('kind') kind: string | undefined, @Query('days') days: string | undefined, @Req() req: { user: AuthenticatedUser }) {
    return this.service.trendObjects(siteId, req.user, { kind, days });
  }

  @Get(':siteId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') get(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.service.get(siteId, req.user);
  }

  @Post(':siteId/refresh') @Roles('ADMIN', 'SYSTEMS_OPERATOR') refresh(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.service.refresh(siteId, req.user);
  }
}
