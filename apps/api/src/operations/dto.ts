import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export enum AlertSeverityDto { CRITICAL = 'CRITICAL', HIGH = 'HIGH', WARNING = 'WARNING', INFO = 'INFO' }
export enum AlertStatusDto { OPEN = 'OPEN', ACKNOWLEDGED = 'ACKNOWLEDGED', SNOOZED = 'SNOOZED', RESOLVED = 'RESOLVED' }

export const ALERT_SNOOZE_MIN_HOURS = 1;
export const ALERT_SNOOZE_MAX_HOURS = 30 * 24;
/** Give exactly one of `until` (ISO date in the future, at most 30 days ahead) or `durationHours` (1–720). */
export class SnoozeAlertDto {
  @IsOptional() @IsDateString() until?: string;
  @IsOptional() @IsInt() @Min(ALERT_SNOOZE_MIN_HOURS) @Max(ALERT_SNOOZE_MAX_HOURS) durationHours?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export const BULK_ALERT_LIMIT = 200;
export type BulkAlertAction = 'ACKNOWLEDGE' | 'SNOOZE' | 'RESOLVE';
export class BulkAlertActionDto {
  @IsIn(['ACKNOWLEDGE', 'SNOOZE', 'RESOLVE']) action!: BulkAlertAction;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_ALERT_LIMIT) @ArrayUnique() @IsUUID('all', { each: true }) ids!: string[];
  /** SNOOZE only: exactly one of until / durationHours. */
  @IsOptional() @IsDateString() until?: string;
  @IsOptional() @IsInt() @Min(ALERT_SNOOZE_MIN_HOURS) @Max(ALERT_SNOOZE_MAX_HOURS) durationHours?: number;
  /** SNOOZE or RESOLVE. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ResolveAlertDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ListAlertsQueryDto {
  @IsOptional() @IsString() siteId?: string;
  @IsOptional() @IsEnum(AlertStatusDto) status?: AlertStatusDto;
  @IsOptional() @IsEnum(AlertSeverityDto) severity?: AlertSeverityDto;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export type UpsertOperationalAlert = {
  dedupKey: string;
  source: string;
  severity: AlertSeverityDto;
  siteId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  title: string;
  detail: string;
  actionHref?: string | null;
  /** Absolute occurrence count for grouped alerts (e.g. a flapping port); omitted means +1 per upsert. */
  occurrenceCount?: number;
};
