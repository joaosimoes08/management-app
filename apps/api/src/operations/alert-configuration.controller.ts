import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AlertConfigurationService } from './alert-configuration.service';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

class AlertRuleDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(100) source!: string;
  @IsOptional() @IsString() siteId?: string | null;
  @IsIn(['CRITICAL', 'HIGH', 'WARNING', 'INFO']) minSeverity!: string;
  @IsBoolean() enabled!: boolean;
}

class MaintenanceWindowDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() siteId?: string | null;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}

@ApiTags('operations') @ApiBearerAuth() @Controller({ path: 'operations/configuration', version: '1' }) @Roles('ADMIN')
export class AlertConfigurationController {
  constructor(private readonly service: AlertConfigurationService) {}
  @Get() list() { return this.service.list(); }
  @Post('rules') createRule(@Body() body: AlertRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.service.saveRule(body, req.user); }
  @Put('rules/:id') updateRule(@Param('id') id: string, @Body() body: AlertRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.service.saveRule({ ...body, id }, req.user); }
  @Delete('rules/:id') deleteRule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.removeRule(id, req.user); }
  @Post('maintenance-windows') createWindow(@Body() body: MaintenanceWindowDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createWindow(body, req.user); }
  @Delete('maintenance-windows/:id') deleteWindow(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.removeWindow(id, req.user); }
}
