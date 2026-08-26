import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { APPLICATION_ROLES, ApplicationRole } from '../auth/roles';

export class UpdateOrganizationSettingsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsIn(['Europe/Lisbon', 'UTC', 'Europe/London', 'Europe/Madrid']) timezone?: string;
  @IsOptional() @IsIn(['pt-PT', 'en-US']) locale?: string;
}

export class UpdateDiscoveryDefaultsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @IsIn(['ICMP', 'TCP'], { each: true }) methods!: string[];
  @IsArray() @ArrayMaxSize(64) @IsInt({ each: true }) @Min(1, { each: true }) @Max(65535, { each: true }) tcpPorts!: number[];
  @IsBoolean() reverseDns!: boolean;
  @IsInt() @Min(1) @Max(168) intervalHours!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(64) @IsString({ each: true }) allowedCidrs!: string[];
}

export class UpdateAuditPolicyDto {
  @IsInt() @Min(1) @Max(3650) retentionDays!: number;
}

export class UpdateUserRolesDto {
  @IsArray() @ArrayMaxSize(APPLICATION_ROLES.length) @IsIn(APPLICATION_ROLES, { each: true }) roles!: ApplicationRole[];
}
