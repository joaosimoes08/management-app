import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsIP, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertSnmpConfigDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsInt() @Min(5) @Max(1440) intervalMinutes?: number;
  @IsOptional() @IsInt() @Min(500) @Max(30000) timeoutMs?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5) retries?: number;
  @IsOptional() @IsBoolean() compatibilitySha1?: boolean;
}

export class SnmpCredentialSecretDto {
  @IsIn(['V2C', 'V3']) version!: 'V2C' | 'V3';
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsString() @MaxLength(64) username?: string;
  @IsOptional() @IsIn(['SHA1', 'SHA256', 'SHA384', 'SHA512']) authProtocol?: 'SHA1' | 'SHA256' | 'SHA384' | 'SHA512';
  @IsOptional() @IsIn(['AES128', 'AES256']) privProtocol?: 'AES128' | 'AES256';
  @IsOptional() @IsString() @MaxLength(255) community?: string;
  @IsOptional() @IsString() @MaxLength(255) authKey?: string;
  @IsOptional() @IsString() @MaxLength(255) privKey?: string;
}

export class CreateSnmpCredentialDto extends SnmpCredentialSecretDto {
  @IsIn(['READ', 'WRITE', 'TRAP']) purpose!: 'READ' | 'WRITE' | 'TRAP';
}

export class CreateSnmpWritePreviewDto {
  @IsIn(['INTERFACE_ADMIN_STATUS', 'SYSTEM_IDENTITY']) operation!: 'INTERFACE_ADMIN_STATUS' | 'SYSTEM_IDENTITY';
  @IsObject() parameters!: Record<string, unknown>;
}

export class AcknowledgeSnmpWriteImpactDto {
  @IsBoolean() impactAcknowledged!: boolean;
}

export class ReviewSnmpDriftDto {
  @IsIn(['ACCEPTED', 'IGNORED']) status!: 'ACCEPTED' | 'IGNORED';
}

export class IgnoreUnmatchedTrapsDto {
  @IsIP() sourceAddress!: string;
}

export class CreateSnmpTrapEnrollmentDto extends SnmpCredentialSecretDto {
  @IsUUID() siteId!: string;
  @IsIP(4) sourceAddress!: string;
  @IsOptional() @IsBoolean() compatibilitySha1?: boolean;
}

export class SnmpOnboardingDeviceDto {
  @IsUUID() siteId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsIn(['SWITCH', 'ROUTER', 'FIREWALL']) type!: 'SWITCH' | 'ROUTER' | 'FIREWALL';
  @IsOptional() @IsString() hostname?: string;
  @IsOptional() @IsUUID() modelId?: string;
  @IsOptional() @IsUUID() frontAssetId?: string;
  @IsOptional() @IsUUID() backAssetId?: string;
  @IsOptional() @IsUUID() rackId?: string;
  @IsOptional() @IsInt() @Min(1) rackUnitStart?: number;
  @IsOptional() @IsInt() @Min(1) rackUnitSize?: number;
  @IsIP() managementIp!: string;
  @ValidateNested() @Type(() => UpsertSnmpConfigDto) config!: UpsertSnmpConfigDto;
  @ValidateNested() @Type(() => SnmpCredentialSecretDto) readCredential!: SnmpCredentialSecretDto;
  @IsOptional() @ValidateNested() @Type(() => SnmpCredentialSecretDto) trapCredential?: SnmpCredentialSecretDto;
}

export class AcceptSnmpEnrollmentDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['SWITCH', 'ROUTER', 'FIREWALL']) type!: 'SWITCH' | 'ROUTER' | 'FIREWALL';
  @IsOptional() @IsString() hostname?: string;
  @IsOptional() @IsUUID() modelId?: string;
  @IsOptional() @IsUUID() frontAssetId?: string;
  @IsOptional() @IsUUID() backAssetId?: string;
}

export class BulkReviewSnmpDriftsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all', { each: true }) ids!: string[];
  @IsIn(['ACCEPTED', 'IGNORED']) status!: 'ACCEPTED' | 'IGNORED';
}

/**
 * SNMP Phase 2 step 9: health alert limits for one Site or Device. PUT replaces the whole override: a field that is
 * null or left out inherits (device → site → default).
 */
export class UpsertSnmpHealthThresholdsDto {
  @IsOptional() @IsNumber() @Min(1) @Max(100) cpuPercent?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) cpuSustainMinutes?: number | null;
  @IsOptional() @IsNumber() @Min(1) @Max(100) memoryPercent?: number | null;
  @IsOptional() @IsNumber() @Min(-40) @Max(150) temperatureHighCelsius?: number | null;
  @IsOptional() @IsNumber() @Min(-40) @Max(150) temperatureCriticalCelsius?: number | null;
  @IsOptional() @IsNumber() @Min(0.1) @Max(1000000) interfaceErrorsPerMinute?: number | null;
}
