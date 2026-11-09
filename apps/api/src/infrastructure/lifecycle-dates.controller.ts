import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { CreateLifecycleDateDto, UpdateLifecycleDateDto } from './dto';
import { LifecycleDatesService } from './lifecycle-dates.service';

@ApiTags('infrastructure') @ApiBearerAuth()
@Controller({ version: '1' })
export class LifecycleDatesController {
  constructor(private readonly service: LifecycleDatesService) {}

  @Get('lifecycle-dates') list(@Query('siteId') siteId: string, @Query('from') from: string, @Query('to') to: string, @Req() req: { user: AuthenticatedUser }) {
    return this.service.list(req.user, siteId, from, to);
  }
  @Post('devices/:deviceId/lifecycle-dates') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  create(@Param('deviceId') deviceId: string, @Body() dto: CreateLifecycleDateDto, @Req() req: { user: AuthenticatedUser }) { return this.service.create(deviceId, dto, req.user); }
  @Patch('lifecycle-dates/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  update(@Param('id') id: string, @Body() dto: UpdateLifecycleDateDto, @Req() req: { user: AuthenticatedUser }) { return this.service.update(id, dto, req.user); }
  @Delete('lifecycle-dates/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR')
  remove(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.remove(id, req.user); }
}
