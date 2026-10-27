import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum FindingStatusDto { OPEN = 'OPEN', ACKNOWLEDGED = 'ACKNOWLEDGED', SNOOZED = 'SNOOZED', RESOLVED = 'RESOLVED' }
export enum FindingSeverityDto { CRITICAL = 'CRITICAL', HIGH = 'HIGH', WARNING = 'WARNING', INFO = 'INFO' }

export class ListFindingsQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsEnum(FindingStatusDto) status?: FindingStatusDto;
  @IsOptional() @IsEnum(FindingSeverityDto) severity?: FindingSeverityDto;
  @IsOptional() @IsString() rule?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export class AssignFindingDto { @IsOptional() @IsUUID() userId?: string | null; }
export class SnoozeFindingDto {
  @IsDateString() until!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class ReconcileInventoryDto { @IsOptional() @IsUUID() siteId?: string; }
