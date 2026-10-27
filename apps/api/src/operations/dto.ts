import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum AlertSeverityDto { CRITICAL = 'CRITICAL', HIGH = 'HIGH', WARNING = 'WARNING', INFO = 'INFO' }
export enum AlertStatusDto { OPEN = 'OPEN', ACKNOWLEDGED = 'ACKNOWLEDGED', SNOOZED = 'SNOOZED', RESOLVED = 'RESOLVED' }

export class SnoozeAlertDto {
  @IsDateString() until!: string;
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
};
