import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { ChangePlansService } from './change-plans.service';
import { AddChecklistItemsDto, CloseChangePlanDto, CreateChangePlanDto, LinkSnmpWriteDto, ReviewChangePlanDto, StartChangePlanDto, TickChecklistItemDto, UpdateChangePlanDto } from './dto';

@ApiTags('change-plans') @ApiBearerAuth() @Controller({ path: 'change-plans', version: '1' })
export class ChangePlansController {
  constructor(private readonly service: ChangePlansService) {}

  @Get() @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  list(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string) { return this.service.list(req.user, siteId, { status, from, to, q }); }

  @Get('summary') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  summary(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string) { return this.service.summary(req.user, siteId); }

  @Get('calendar') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  calendar(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('includeCancelled') includeCancelled?: string) { return this.service.calendar(req.user, siteId, from, to, includeCancelled === 'true' || includeCancelled === '1'); }

  @Get('candidates') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  candidates(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string, @Query('q') q?: string, @Query('type') type?: string) { return this.service.candidates(req.user, siteId, q, type); }

  @Get('attachable') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  attachable(@Req() req: { user: AuthenticatedUser }, @Query('deviceId', ParseUUIDPipe) deviceId: string, @Query('at') at?: string) { return this.service.attachablePlans(req.user, deviceId, at); }

  @Get(':id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  get(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.get(req.user, id); }

  @Get(':id/activity') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  activity(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.activity(req.user, id); }

  @Post() @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  create(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateChangePlanDto) { return this.service.create(req.user, dto); }

  @Patch(':id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  update(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateChangePlanDto) { return this.service.update(req.user, id, dto); }

  @Post(':id/impact-preview') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  preview(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.preview(req.user, id); }

  @Post(':id/submit') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  submit(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.submit(req.user, id); }

  @Post(':id/review') @Roles('ADMIN')
  review(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: ReviewChangePlanDto) { return this.service.review(req.user, id, dto); }

  @Post(':id/cancel') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  cancel(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.cancel(req.user, id); }

  // Step 30 — implementation and close-out
  @Post(':id/start') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  start(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: StartChangePlanDto) { return this.service.start(req.user, id, dto); }

  @Post(':id/close') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  close(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: CloseChangePlanDto) { return this.service.close(req.user, id, dto); }

  @Get(':id/checklist') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  checklist(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.checklist(req.user, id); }

  @Post(':id/checklist') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  addChecklist(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: AddChecklistItemsDto) { return this.service.addChecklistItems(req.user, id, dto.labels); }

  @Patch(':id/checklist/:itemId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  tickChecklist(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: TickChecklistItemDto) { return this.service.tickChecklistItem(req.user, id, itemId, dto.done); }

  @Delete(':id/checklist/:itemId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  removeChecklist(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Param('itemId', ParseUUIDPipe) itemId: string) { return this.service.removeChecklistItem(req.user, id, itemId); }

  @Get(':id/post-change-check') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  postChangeCheck(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.postChangeCheck(req.user, id); }

  @Get(':id/conflicts') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  conflicts(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.conflicts(req.user, id); }

  @Post(':id/snmp-writes') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  linkSnmpWrite(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: LinkSnmpWriteDto) { return this.service.linkSnmpWrite(req.user, id, dto.snmpWriteRequestId); }

  @Delete(':id/snmp-writes/:writeId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  unlinkSnmpWrite(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Param('writeId', ParseUUIDPipe) writeId: string) { return this.service.unlinkSnmpWrite(req.user, id, writeId); }
}
