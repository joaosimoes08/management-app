import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { AuthenticatedUser } from '../auth/auth.service';
import { TagsService } from './tags.service';
import { ApiBodyExamples, ApiCreatedExamples, ApiOkExamples } from '../docs/api-examples.decorator';
import { TAG_CATALOG_ROLES, TAG_COLORS, TAG_NAME_MAX_LENGTH, TAGS_PER_ITEM_LIMIT } from './tag-rules';

export class CreateTagDto {
  @IsUUID() siteId!: string;
  @IsString() @MaxLength(TAG_NAME_MAX_LENGTH * 2) name!: string;
  @IsOptional() @IsIn([...TAG_COLORS]) color?: string;
}
export class UpdateTagDto {
  @IsOptional() @IsString() @MaxLength(TAG_NAME_MAX_LENGTH * 2) name?: string;
  @IsOptional() @IsIn([...TAG_COLORS]) color?: string;
}
export class SetTagsDto {
  @IsArray() @ArrayMaxSize(TAGS_PER_ITEM_LIMIT) @IsUUID('all', { each: true }) tagIds!: string[];
}

/**
 * Step 36 — site-scoped tags.
 * GET    /v1/tags?siteId=…            → [{ id, siteId, name, color, deviceCount, subnetCount, createdAt, updatedAt }]
 * POST   /v1/tags { siteId, name, color? }
 * PATCH  /v1/tags/:id { name?, color? }
 * DELETE /v1/tags/:id                 → also removes it from every device and subnet
 * PUT    /v1/devices/:id/tags { tagIds } → { deviceId, tags }  (replaces the set; [] clears)
 * PUT    /v1/subnets/:id/tags { tagIds } → { subnetId, tags }
 * Catalog changes (POST/PATCH/DELETE /v1/tags): ADMIN and SYSTEMS_OPERATOR only; NETWORK_OPERATOR gets 403 but may assign tags.
 * Names are trimmed and checked again in the service (1–40 characters, unique per Site ignoring case).
 */
@ApiTags('tags') @ApiBearerAuth() @Controller({ version: '1' })
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Get('tags') @ApiOkExamples(['tags.list']) list(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.service.list(req.user, siteId); }
  @Post('tags') @Roles(...TAG_CATALOG_ROLES) @ApiBodyExamples(CreateTagDto, 'tags.create.request') @ApiCreatedExamples(['tags.create.response']) create(@Body() dto: CreateTagDto, @Req() req: { user: AuthenticatedUser }) { return this.service.create(req.user, dto); }
  @Patch('tags/:id') @Roles(...TAG_CATALOG_ROLES) update(@Param('id') id: string, @Body() dto: UpdateTagDto, @Req() req: { user: AuthenticatedUser }) { return this.service.update(req.user, id, dto); }
  @Delete('tags/:id') @Roles(...TAG_CATALOG_ROLES) remove(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.remove(req.user, id); }
  @Put('devices/:id/tags') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') setDeviceTags(@Param('id') id: string, @Body() dto: SetTagsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.setDeviceTags(req.user, id, dto.tagIds); }
  @Put('subnets/:id/tags') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') setSubnetTags(@Param('id') id: string, @Body() dto: SetTagsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.setSubnetTags(req.user, id, dto.tagIds); }
}
