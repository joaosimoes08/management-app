import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsIP, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateSiteDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(2) @MaxLength(30) code!: string;
  @IsOptional() @IsString() @MaxLength(180) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
}
export class UpdateSiteDto extends CreateSiteDto {}
export class CreateVlanDto {
  @IsInt() @Min(1) @Max(4094) vlanId!: number;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsString() siteId?: string;
}
export class UpdateVlanDto extends CreateVlanDto {}
export class CreateSubnetDto {
  @IsString() @MinLength(3) @MaxLength(50) cidr!: string;
  @IsOptional() @IsIP() gateway?: string;
  @IsOptional() @IsString() @MaxLength(100) purpose?: string;
  @IsOptional() @IsString() @MaxLength(50) environment?: string;
  @IsOptional() @IsString() siteId?: string;
  @IsOptional() @IsString() vlanId?: string;
  @IsOptional() @IsInt() @IsIn([4, 6]) version?: number;
  @IsOptional() @IsString() vrfId?: string;
  @IsOptional() @IsString() parentSubnetId?: string;
}
export class UpdateSubnetDto extends PartialType(CreateSubnetDto) {}
export class CreateIpDto {
  @IsString() @IsIP() address!: string;
  @IsString() subnetId!: string;
  @IsOptional() @IsIn(['FREE', 'OCCUPIED', 'RESERVED', 'EXCLUDED', 'UNKNOWN']) state?: string;
  @IsOptional() @IsString() @MaxLength(160) hostname?: string;
  @IsOptional() @IsString() @MaxLength(40) macAddress?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsInt() @IsIn([4, 6]) version?: number;
  @IsOptional() @IsUUID() hostId?: string;
  @IsOptional() @IsUUID() deviceId?: string | null;
  @IsOptional() @IsUUID() interfaceId?: string;
}
export class UpdateIpDto {
  @IsOptional() @IsIP() address?: string;
  @IsOptional() @IsIn(['FREE', 'OCCUPIED', 'RESERVED', 'EXCLUDED', 'UNKNOWN']) state?: string;
  @IsOptional() @IsString() @MaxLength(160) hostname?: string;
  @IsOptional() @IsString() @MaxLength(40) macAddress?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsUUID() hostId?: string;
  @IsOptional() @IsUUID() deviceId?: string | null;
  @IsOptional() @IsUUID() interfaceId?: string;
}
export class UpdateSubnetScanDto {
  @IsBoolean() enabled!: boolean;
  @IsArray() @IsIn(['ICMP', 'TCP'], { each: true }) methods!: string[];
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(65535, { each: true }) tcpPorts?: number[];
  @IsOptional() @IsBoolean() reverseDns?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) intervalHours?: number;
}
export class CalculatorDto {
  @IsOptional() @IsString() cidr?: string;
  @IsIn(['summary', 'split', 'contains', 'overlap']) operation!: string;
  @IsOptional() @IsInt() @Min(0) @Max(32) newPrefix?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() basePrefix?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) cidrs?: string[];
}
export class CreateVrfDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(80) routeDistinguisher?: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsString() siteId!: string;
  @IsOptional() @IsString() status?: string;
}
export class UpdateVrfDto extends CreateVrfDto {}
export class CreateNatRuleDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsIn(['SNAT', 'DNAT', 'STATIC_1_TO_1', 'PAT']) type!: string;
  @IsOptional() @IsString() protocol?: string;
  @IsOptional() @IsString() sourceAddress?: string;
  @IsOptional() @IsString() translatedAddress?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) sourcePort?: number;
  @IsOptional() @IsInt() @Min(1) @Max(65535) translatedPort?: number;
  @IsOptional() @IsInt() @Min(1) @Max(65535) destinationPort?: number;
  @IsOptional() @IsString() sourceSubnetId?: string;
  @IsOptional() @IsString() translatedSubnetId?: string;
  @IsOptional() @IsString() sourceIpId?: string;
  @IsOptional() @IsString() translatedIpId?: string;
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() vrfId?: string;
  @IsOptional() @IsString() siteId?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
export class UpdateNatRuleDto extends CreateNatRuleDto {}
export class CreateIpamGroupDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsString() siteId?: string;
}
export class UpdateIpamGroupDto extends CreateIpamGroupDto {}
export class IpamGroupMemberDto { @IsUUID() userId!: string; }
export class CreateIpamPermissionDto {
  @IsString() groupId!: string;
  @IsIn(['SITE', 'VRF', 'VLAN', 'SUBNET']) scopeType!: string;
  @IsString() scopeId!: string;
  @IsIn(['READ', 'CREATE', 'UPDATE', 'DELETE', 'DISCOVER', 'IMPORT']) permission!: string;
}
export class UpdateIpamPermissionDto extends CreateIpamPermissionDto {}
export class RipePreviewDto {
  @IsString() @MinLength(2) @MaxLength(160) query!: string;
  @IsOptional() @IsIn(['asn', 'organisation', 'prefix']) queryType?: string;
}
export class RipeImportDto {
  @IsString() importId!: string;
  @IsArray() @IsString({ each: true }) prefixes!: string[];
  @IsString() siteId!: string;
  @IsOptional() @IsString() vrfId?: string;
  @IsOptional() @IsString() vlanId?: string;
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() environment?: string;
}
export class CreateDiscoveryJobDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() subnetId!: string;
  @IsArray() @IsIn(['ICMP', 'TCP'], { each: true }) methods!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(64) @IsInt({ each: true }) @Min(1, { each: true }) @Max(65535, { each: true }) tcpPorts?: number[];
  @IsOptional() @IsBoolean() reverseDns?: boolean;
}
export class UpdateDiscoveryScheduleDto {
  @IsBoolean() enabled!: boolean;
  @IsArray() @IsIn(['ICMP', 'TCP'], { each: true }) methods!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(64) @IsInt({ each: true }) @Min(1, { each: true }) @Max(65535, { each: true }) tcpPorts?: number[];
  @IsOptional() @IsBoolean() reverseDns?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) intervalHours?: number;
}
export class ReviewDiscoveryResultDto {
  @IsIn(['APPROVED', 'IGNORED']) status!: string;
}
export class CreateHostDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(160) hostname?: string;
  @IsOptional() @IsString() @MaxLength(120) operatingSystem?: string;
  @IsOptional() @IsString() @MaxLength(40) macAddress?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN']) status?: string;
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() ipAddressId?: string;
}
export class UpdateHostDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(160) hostname?: string;
  @IsOptional() @IsString() @MaxLength(120) operatingSystem?: string;
  @IsOptional() @IsString() @MaxLength(40) macAddress?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN']) status?: string;
  @IsOptional() @IsUUID() deviceId?: string;
}
export class CreateServiceDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsIn(['TCP', 'UDP', 'OTHER']) protocol?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['UNKNOWN', 'OPEN', 'CLOSED', 'DEGRADED', 'DISABLED']) status?: string;
  @IsOptional() @IsString() @MaxLength(80) version?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsUUID() hostId!: string;
}
export class UpdateServiceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['TCP', 'UDP', 'OTHER']) protocol?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['UNKNOWN', 'OPEN', 'CLOSED', 'DEGRADED', 'DISABLED']) status?: string;
  @IsOptional() @IsString() @MaxLength(80) version?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
