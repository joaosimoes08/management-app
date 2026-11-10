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
  list(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string) { return this.service.list(req.user, siteId); }

  @Get('candidates') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  candidates(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId: string) { return this.service.candidates(req.user, siteId); }

  @Get(':id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  get(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.get(req.user, id); }

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
