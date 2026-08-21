import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { OrganizationDto } from './dto/organization.dto';
import { InitialSiteDto } from './dto/site.dto';
import { SetupService } from './setup.service';

@ApiTags('setup')
@ApiBearerAuth()
@Controller({ path: 'setup', version: '1' })
export class SetupController {
  constructor(private readonly service: SetupService) {}

  @Get('status')
  status() { return this.service.status(); }

  @Post('organization')
  @Roles('ADMIN')
  organization(@Body() dto: OrganizationDto, @Req() request: { user: AuthenticatedUser }) { return this.service.saveOrganization(dto, request.user); }

  @Post('site')
  @Roles('ADMIN')
  site(@Body() dto: InitialSiteDto, @Req() request: { user: AuthenticatedUser }) { return this.service.createSite(dto, request.user); }

  @Post('complete')
  @Roles('ADMIN')
  complete(@Req() request: { user: AuthenticatedUser }) { return this.service.complete(request.user); }

  @Post('reopen')
  @Roles('ADMIN')
  reopen(@Req() request: { user: AuthenticatedUser }) { return this.service.reopen(request.user); }
}
