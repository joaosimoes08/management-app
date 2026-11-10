import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.service';
import { CriticalAssetsService } from './critical-assets.service';

class MappingDto {
  @IsIn(['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER']) assetType!: string;
  @IsUUID() groupId!: string;
  @IsString() timezone!: string;
}
class ConfirmDto {
  @IsIn(['CONFIRMED', 'CORRECTION_NEEDED']) outcome!: string;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('critical-assets') @ApiBearerAuth() @Controller({ version: '1', path: 'critical-assets' })
export class CriticalAssetsController {
  constructor(private readonly service: CriticalAssetsService) {}
  @Get() @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR') list(@Query('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.list(siteId, req.user); }
  @Post('mapping') @Roles('ADMIN', 'SYSTEMS_OPERATOR') setMapping(@Body() dto: MappingDto, @Query('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.setMapping(siteId, dto.assetType, dto.groupId, dto.timezone, req.user); }
  @Post(':id/confirm') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR') confirm(@Param('id') id: string, @Body() dto: ConfirmDto, @Req() req: { user: AuthenticatedUser }) { return this.service.confirm(id, dto.outcome, dto.notes, req.user); }
}
