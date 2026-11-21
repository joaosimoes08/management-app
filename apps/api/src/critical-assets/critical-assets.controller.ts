import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.service';
import { IsIanaTimeZone } from '../common/time-zone';
import { AssetQuery, BULK_CONFIRM_LIMIT, CriticalAssetsService } from './critical-assets.service';

class MappingDto {
  @IsIn(['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER']) assetType!: string;
  @IsUUID() groupId!: string;
  @IsIanaTimeZone() timezone!: string;
}
class ConfirmDto {
  @IsIn(['CONFIRMED', 'NEEDS_CORRECTION', 'NOT_FOUND']) outcome!: string;
  @IsOptional() @IsString() notes?: string;
}
class BulkConfirmDto {
  @IsArray() @ArrayMaxSize(BULK_CONFIRM_LIMIT) items!: Array<{ id: string; outcome: string; notes?: string }>;
}
class CloseCorrectionDto {
  @IsOptional() @IsString() changeReference?: string;
  @IsOptional() @IsString() note?: string;
}

const REVIEWERS = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'] as const;
const VIEWERS = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR'] as const;

@ApiTags('critical-assets') @ApiBearerAuth() @Controller({ version: '1', path: 'critical-assets' })
export class CriticalAssetsController {
  constructor(private readonly service: CriticalAssetsService) {}
  @Get() @Roles(...VIEWERS) list(@Query('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.list(siteId, req.user); }
  @Get('cadence') @Roles(...VIEWERS) cadence(@Query('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.cadence(siteId, req.user); }
  @Patch('cadence') @Roles('ADMIN') saveCadence(@Query('siteId') siteId: string, @Body() dto: unknown, @Req() req: { user: AuthenticatedUser }) { return this.service.saveCadence(siteId, dto, req.user); }
  @Get('summary') @Roles(...VIEWERS) summary(@Query('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.summary(siteId, req.user); }
  @Get('assets') @Roles(...VIEWERS) page(@Query('siteId') siteId: string, @Query() query: Record<string, string | undefined>, @Req() req: { user: AuthenticatedUser }) {
    const assetQuery: AssetQuery = { type: query.type, owner: query.owner, outcome: query.outcome, due: query.due, tier: query.tier, q: query.q, page: query.page ? Number(query.page) : undefined, pageSize: query.pageSize ? Number(query.pageSize) : undefined };
    return this.service.page(siteId, assetQuery, req.user);
  }
  @Post('mapping') @Roles('ADMIN', 'SYSTEMS_OPERATOR') setMapping(@Body() dto: MappingDto, @Query('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.setMapping(siteId, dto.assetType, dto.groupId, dto.timezone, req.user); }
  @Post(':id/confirm') @Roles(...REVIEWERS) confirm(@Param('id') id: string, @Body() dto: ConfirmDto, @Req() req: { user: AuthenticatedUser }) { return this.service.confirm(id, dto.outcome, dto.notes, req.user); }
  @Post('confirm-bulk') @Roles(...REVIEWERS) confirmBulk(@Body() dto: BulkConfirmDto, @Req() req: { user: AuthenticatedUser }) { return this.service.confirmBulk(dto.items, req.user); }
  @Get('corrections') @Roles(...VIEWERS) corrections(@Query('siteId') siteId: string, @Query('status') status: string | undefined, @Req() req: { user: AuthenticatedUser }) { return this.service.listCorrections(siteId, status, req.user); }
  @Post('corrections/:id/resolve') @Roles(...REVIEWERS) resolveCorrection(@Param('id') id: string, @Body() dto: CloseCorrectionDto, @Req() req: { user: AuthenticatedUser }) { return this.service.closeCorrection(id, 'RESOLVED', dto, req.user); }
  @Post('corrections/:id/reject') @Roles(...REVIEWERS) rejectCorrection(@Param('id') id: string, @Body() dto: CloseCorrectionDto, @Req() req: { user: AuthenticatedUser }) { return this.service.closeCorrection(id, 'REJECTED', dto, req.user); }
}
