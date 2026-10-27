import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AssignFindingDto, ListFindingsQueryDto, ReconcileInventoryDto, SnoozeFindingDto } from './dto';
import { InventoryQualityService } from './inventory-quality.service';

@ApiTags('inventory-quality') @ApiBearerAuth() @Controller({ path: 'inventory-quality', version: '1' })
export class InventoryQualityController {
  constructor(private readonly service: InventoryQualityService) {}
  @Get('findings') list(@Req() req: { user: AuthenticatedUser }, @Query() query: ListFindingsQueryDto) { return this.service.list(req.user, query); }
  @Get('summary') summary(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.service.summary(req.user, siteId); }
  @Get('assignees') assignees(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string) { return this.service.assignees(req.user, siteId); }
  @Patch('findings/:id/acknowledge') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') acknowledge(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.acknowledge(req.user, id); }
  @Patch('findings/:id/assign') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') assign(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: AssignFindingDto) { return this.service.assign(req.user, id, dto); }
  @Patch('findings/:id/snooze') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') snooze(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: SnoozeFindingDto) { return this.service.snooze(req.user, id, dto); }
  @Post('reconcile') @Roles('ADMIN') reconcile(@Req() req: { user: AuthenticatedUser }, @Body() dto: ReconcileInventoryDto) { return this.service.reconcile(req.user, dto.siteId); }
}
