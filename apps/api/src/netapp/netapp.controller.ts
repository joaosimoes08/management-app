import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
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

  @Get(':siteId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') get(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.service.get(siteId, req.user);
  }

  @Post(':siteId/refresh') @Roles('ADMIN', 'SYSTEMS_OPERATOR') refresh(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.service.refresh(siteId, req.user);
  }
}
