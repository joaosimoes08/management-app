import { Body, Controller, Get, Patch, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/roles.decorator';
import { DashboardRoleDto, SaveDashboardLayoutDto, SaveDashboardPreferenceDto } from './dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  summary(@Req() request: { user: AuthenticatedUser }) { return this.service.summary(request.user); }

  @Get('search')
  search(@Query('q') query: string | undefined, @Query('limit') limit: string | undefined, @Req() request: { user: AuthenticatedUser }) {
    return this.service.search(query, limit, request.user);
  }

  @Get('topbar-state')
  topbarState(@Req() request: { user: AuthenticatedUser }) { return this.service.topbarState(request.user); }

  @Patch('notifications/read-all')
  readNotifications(@Req() request: { user: AuthenticatedUser }) { return this.service.readNotifications(request.user); }

  @Get('workspaces')
  workspaces(@Req() request: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.service.workspaces(request.user, siteId); }

  @Get('layout')
  layout(@Req() request: { user: AuthenticatedUser }, @Query('siteId') siteId: string, @Query('role') role: DashboardRoleDto) { return this.service.layout(request.user, siteId, role); }

  @Put('layout') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  saveLayout(@Req() request: { user: AuthenticatedUser }, @Body() dto: SaveDashboardLayoutDto) { return this.service.saveLayout(request.user, dto); }

  @Put('preference')
  preference(@Req() request: { user: AuthenticatedUser }, @Body() dto: SaveDashboardPreferenceDto) { return this.service.savePreference(request.user, dto); }

  @Get('operational-summary')
  operationalSummary(@Req() request: { user: AuthenticatedUser }, @Query('siteId') siteId: string, @Query('role') role: DashboardRoleDto) { return this.service.operationalSummary(request.user, siteId, role); }
}
