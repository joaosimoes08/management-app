import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { BulkAlertActionDto, ListAlertsQueryDto, ResolveAlertDto, SnoozeAlertDto } from './dto';
import { OperationsService } from './operations.service';

@ApiTags('operations') @ApiBearerAuth() @Controller({ path: 'operations', version: '1' })
export class OperationsController {
  constructor(private readonly service: OperationsService) {}
  @Get('alerts') list(@Req() req: { user: AuthenticatedUser }, @Query() query: ListAlertsQueryDto) { return this.service.list(req.user, query); }
  @Get('alerts/summary') summary(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.service.summary(req.user, siteId); }
  @Get('alerts/sources') sources() { return this.service.sources(); }
  @Get('alerts/:id') detail(@Req() req: { user: AuthenticatedUser }, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.detail(req.user, id); }
  /** At most 200 ids; each one is checked and reported on its own. */
  @Post('alerts/bulk') @HttpCode(200) @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') bulk(@Req() req: { user: AuthenticatedUser }, @Body() dto: BulkAlertActionDto) { return this.service.bulk(req.user, dto); }
  @Get('maintenance/summary') maintenanceSummary(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('days') days?: string) { return this.service.maintenanceSummary(req.user, siteId, days); }
  @Sse('events') events(@Req() req: { user: AuthenticatedUser }) { return this.service.stream(req.user); }
  @Patch('alerts/:id/acknowledge') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') acknowledge(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.acknowledge(req.user, id); }
  @Patch('alerts/:id/snooze') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') snooze(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: SnoozeAlertDto) { return this.service.snooze(req.user, id, dto); }
  @Patch('alerts/:id/resolve') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') resolve(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: ResolveAlertDto) { return this.service.resolve(req.user, id, dto); }
  @Patch('alerts/read-all') readAll(@Req() req: { user: AuthenticatedUser }) { return this.service.readAll(req.user); }
}
