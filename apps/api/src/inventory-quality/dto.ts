import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export enum FindingStatusDto { OPEN = 'OPEN', ACKNOWLEDGED = 'ACKNOWLEDGED', SNOOZED = 'SNOOZED', RESOLVED = 'RESOLVED' }
export enum FindingSeverityDto { CRITICAL = 'CRITICAL', HIGH = 'HIGH', WARNING = 'WARNING', INFO = 'INFO' }

export class ListFindingsQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsEnum(FindingStatusDto) status?: FindingStatusDto;
  @IsOptional() @IsEnum(FindingSeverityDto) severity?: FindingSeverityDto;
  @IsOptional() @IsString() rule?: string;
  @IsOptional() @IsString() search?: string;
  /** A user id, `me`, or `unassigned`. */
  @IsOptional() @IsString() @MaxLength(64) assignee?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export class AssignFindingDto { @IsOptional() @IsUUID() userId?: string | null; }
export const SNOOZE_MIN_HOURS = 1;
export const SNOOZE_MAX_HOURS = 30 * 24;
/** Give exactly one of `until` (ISO date, 1h–30d from now) or `durationHours` (1–720). */
export class SnoozeFindingDto {
  @IsOptional() @IsDateString() until?: string;
  @IsOptional() @IsInt() @Min(SNOOZE_MIN_HOURS) @Max(SNOOZE_MAX_HOURS) durationHours?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export const BULK_FINDING_LIMIT = 200;
export class BulkFindingActionDto {
  @IsIn(['ACKNOWLEDGE', 'ASSIGN', 'SNOOZE']) action!: 'ACKNOWLEDGE' | 'ASSIGN' | 'SNOOZE';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_FINDING_LIMIT) @ArrayUnique() @IsUUID('all', { each: true }) ids!: string[];
  /** ASSIGN only. Omit or null to unassign. */
  @IsOptional() @IsUUID() userId?: string | null;
  /** SNOOZE only: exactly one of until / durationHours. */
  @IsOptional() @IsDateString() until?: string;
  @IsOptional() @IsInt() @Min(SNOOZE_MIN_HOURS) @Max(SNOOZE_MAX_HOURS) durationHours?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class FindingFacetsQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsEnum(FindingStatusDto) status?: FindingStatusDto;
  @IsOptional() @IsEnum(FindingSeverityDto) severity?: FindingSeverityDto;
  @IsOptional() @IsString() rule?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() @MaxLength(64) assignee?: string;
}
export class ReconcileInventoryDto { @IsOptional() @IsUUID() siteId?: string; }
