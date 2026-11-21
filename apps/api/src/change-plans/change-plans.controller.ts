import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { ChangePlansService } from './change-plans.service';
import { CreateChangePlanDto, ReviewChangePlanDto, UpdateChangePlanDto } from './dto';

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
}
