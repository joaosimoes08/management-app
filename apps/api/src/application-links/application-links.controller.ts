import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { ApplicationLinksService } from './application-links.service';
import { CreateApplicationLinkDto } from './dto/create-application-link.dto';
import { UpdateApplicationLinkDto } from './dto/update-application-link.dto';

@ApiTags('application-links')
@ApiBearerAuth()
@Controller({ path: 'application-links', version: '1' })
export class ApplicationLinksController {
  constructor(private readonly service: ApplicationLinksService) {}

  @Get()
  list(@Req() request: { user: AuthenticatedUser }, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(request.user, includeInactive === 'true');
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateApplicationLinkDto, @Req() request: { user: AuthenticatedUser }) { return this.service.create(dto, request.user); }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationLinkDto, @Req() request: { user: AuthenticatedUser }) { return this.service.update(id, dto, request.user); }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @Req() request: { user: AuthenticatedUser }) { await this.service.remove(id, request.user); return { success: true }; }

  @Post(':id/check')
  @Roles('ADMIN')
  check(@Param('id') id: string, @Req() request: { user: AuthenticatedUser }) { return this.service.check(id, request.user); }
}
