import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export enum DashboardRoleDto { ADMIN = 'ADMIN', NETWORK_OPERATOR = 'NETWORK_OPERATOR', SYSTEMS_OPERATOR = 'SYSTEMS_OPERATOR', AUDITOR = 'AUDITOR', READ_ONLY = 'READ_ONLY' }

export class DashboardWidgetDto {
  @IsString() id!: string;
  @IsInt() @Min(0) x!: number;
  @IsInt() @Min(0) y!: number;
  @IsInt() @Min(1) @Max(12) w!: number;
  @IsInt() @Min(1) @Max(12) h!: number;
  @IsOptional() @IsBoolean() visible?: boolean;
}
export class SaveDashboardLayoutDto {
  @IsUUID() siteId!: string;
  @IsEnum(DashboardRoleDto) role!: DashboardRoleDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DashboardWidgetDto) widgets!: DashboardWidgetDto[];
  @IsOptional() @IsInt() revision?: number;
}
export class SaveDashboardPreferenceDto {
  @IsUUID() siteId!: string;
  @IsEnum(DashboardRoleDto) role!: DashboardRoleDto;
}
