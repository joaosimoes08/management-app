import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

const deviceTypes = ['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER'];
const statuses = ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN'];

export class CreateDeviceModelDto {
  @IsString() @MinLength(1) manufacturer!: string;
  @IsString() @MinLength(1) model!: string;
  @IsOptional() @IsIn(deviceTypes) type?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1024) portCount?: number;
  @IsOptional() @IsBoolean() supportsNetworkPorts?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(4096) networkPortCount?: number;
  @IsOptional() capabilities?: unknown;
  @IsOptional() @IsString() frontAssetId?: string;
  @IsOptional() @IsString() backAssetId?: string;
  @IsOptional() @IsString() iconAssetId?: string;
  @IsOptional() portLayout?: unknown;
}
export class UpdateDeviceModelDto extends CreateDeviceModelDto {}

export class CreateDeviceDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @IsIn(deviceTypes) type!: string;
  @IsOptional() @IsString() hostname?: string;
  @IsOptional() @IsString() managementIp?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() assetTag?: string;
  @IsOptional() @IsIn(statuses) status?: string;
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsString() siteId?: string;
  @IsOptional() @IsString() rackId?: string;
  @IsOptional() @IsInt() rackUnitStart?: number;
  @IsOptional() @IsInt() rackUnitSize?: number;
  @IsOptional() @IsString() frontAssetId?: string;
  @IsOptional() @IsString() iconAssetId?: string;
  @IsOptional() @IsString() managementIpAddressId?: string;
  @IsOptional() @IsString() notes?: string;
}
export class UpdateDeviceDto extends CreateDeviceDto {}

export class CreateInterfaceDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() portKey?: string;
  @IsOptional() @IsString() interfaceType?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() adminUp?: boolean;
  @IsOptional() @IsBoolean() operUp?: boolean;
  @IsOptional() @IsInt() @Min(1) speedMbps?: number;
  @IsOptional() @IsString() mode?: string;
  @IsOptional() @IsString() nativeVlanId?: string;
  @IsOptional() @IsString() accessVlanId?: string;
  @IsOptional() @IsString() macAddress?: string;
  @IsOptional() allowedVlanIds?: string[];
}
export class UpdateInterfaceDto extends CreateInterfaceDto {
  // Backwards-compatible read-only fields accepted from older clients and discarded by the service.
  @IsOptional() id?: string;
  @IsOptional() source?: unknown;
  @IsOptional() lastSeenAt?: unknown;
  @IsOptional() deviceId?: string;
  @IsOptional() nativeVlan?: unknown;
  @IsOptional() accessVlan?: unknown;
  @IsOptional() allowedVlans?: unknown;
  @IsOptional() ipAddresses?: unknown;
}

export class UpdatePortLayoutDto {
  @IsOptional() imageWidth?: number;
  @IsOptional() imageHeight?: number;
  @IsOptional() ports?: unknown[];
  @IsOptional() viewport?: unknown;
  @IsOptional() confidence?: number;
  @IsOptional() confirmedAt?: string;
  @IsOptional() confirmedBy?: string;
  @IsOptional() warnings?: unknown;
  @IsOptional() @IsString() assetId?: string;
}

export class DetectPortLayoutDto {
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsInt() @Min(1) imageWidth?: number;
  @IsOptional() @IsInt() @Min(1) imageHeight?: number;
  @IsOptional() @IsInt() @Min(1) portCount?: number;
  @IsOptional() @IsInt() @Min(1) columns?: number;
  @IsOptional() @IsString() portType?: string;
}

export class CreateRackModelDto {
  @IsString() @MinLength(1) manufacturer!: string;
  @IsString() @MinLength(1) model!: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) units?: number;
  @IsOptional() @IsInt() @Min(1) widthMm?: number;
  @IsOptional() @IsInt() @Min(1) depthMm?: number;
  @IsOptional() @IsString() iconAssetId?: string;
  @IsOptional() @IsString() frontAssetId?: string;
  @IsOptional() capabilities?: unknown;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateRackModelDto extends CreateRackModelDto {}
export class CreateRackDto {
  @IsString() @MinLength(1) name!: string;
  @IsInt() @Min(1) @Max(60) units!: number;
  @IsString() roomId!: string;
  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsString() frontAssetId?: string;
}
export class UpdateRackDto extends CreateRackDto {}

export class CreateBuildingDto {
  @IsString() @MinLength(1) name!: string;
}
export class UpdateBuildingDto extends CreateBuildingDto {}
export class CreateRoomDto {
  @IsString() @MinLength(1) name!: string;
}
export class UpdateRoomDto extends CreateRoomDto {}

export class CreateAssetDto {
  @IsString() @MinLength(1) filename!: string;
  @IsString() mimeType!: string;
  @IsString() @MinLength(1) kind!: string;
  @IsOptional() @IsString() license?: string;
  @IsString() @MinLength(1) contentBase64!: string;
}
