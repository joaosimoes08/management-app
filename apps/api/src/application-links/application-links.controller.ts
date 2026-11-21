import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { ApplicationLinksService } from './application-links.service';
import { CreateApplicationLinkDto } from './dto/create-application-link.dto';
import { UpdateApplicationLinkDto } from './dto/update-application-link.dto';

class FavoriteDto {
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

@ApiTags('application-links')
@ApiBearerAuth()
@Controller({ path: 'application-links', version: '1' })
export class ApplicationLinksController {
  constructor(private readonly service: ApplicationLinksService) {}

  @Get()
  list(@Req() request: { user: AuthenticatedUser }, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(request.user, includeInactive === 'true');
  }

  @Get('favorites')
  favorites(@Req() request: { user: AuthenticatedUser }) { return this.service.favorites(request.user); }

  @Put(':id/favorite')
  setFavorite(@Param('id') id: string, @Body() dto: FavoriteDto, @Req() request: { user: AuthenticatedUser }) { return this.service.setFavorite(id, request.user, dto?.sortOrder); }

  @Delete(':id/favorite')
  removeFavorite(@Param('id') id: string, @Req() request: { user: AuthenticatedUser }) { return this.service.removeFavorite(id, request.user); }

  @Post('check-all')
  @Roles('ADMIN')
  checkAll(@Req() request: { user: AuthenticatedUser }, @Query('all') all?: string, @Query('offset') offset?: string) { return this.service.checkAll(request.user, all === 'true', offset); }

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
