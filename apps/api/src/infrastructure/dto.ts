import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { DevicePowerDto, PduSettingsDto } from './power/dto';
import { MAX_POWER_PLUG_COUNT, MAX_WATTS, MIN_POWER_PLUG_COUNT } from './power/power-defaults';
import { RACK_POWER_MODES, type RackPowerMode } from './power/rack-power';

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
  @IsOptional() portLayout?: unknown;
  /** Power: plug count (0–8) and estimated draw. null clears the value (falls back to defaults). */
  @IsOptional() @IsInt() @Min(MIN_POWER_PLUG_COUNT) @Max(MAX_POWER_PLUG_COUNT) powerPlugCount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_WATTS) typicalWatts?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_WATTS) maxWatts?: number | null;
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
  /** Per-device rear image override; falls back to the model's backAsset. */
  @IsOptional() @IsString() backAssetId?: string;
  @IsOptional() @IsString() managementIpAddressId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isCritical?: boolean;
  /** Criticality tier (T1 vital, T2 important, T3 standard). null clears it. Source of truth; isCritical follows it. */
  @IsOptional() @IsIn(['T1','T2','T3']) criticalityTier?: 'T1' | 'T2' | 'T3' | null;
  /** Power overrides. null = fall back to the model, then to the type default. Outlets are set via PUT devices/:id/power. */
  @IsOptional() @IsInt() @Min(MIN_POWER_PLUG_COUNT) @Max(MAX_POWER_PLUG_COUNT) powerPlugCount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_WATTS) estimatedWatts?: number | null;
  /**
   * Outlet assignments saved in the same transaction as the device (same body as PUT devices/:id/power; `{}` =
   * default distribution). Required on create for a racked device with at least 1 plug; on update, required when the
   * device moves to another rack and had outlets configured. See docs/device-required-config.md.
   */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => DevicePowerDto) power?: DevicePowerDto;
}
export class UpdateDeviceDto extends CreateDeviceDto {}

export class CreateLifecycleDateDto {
  @IsIn(['LICENSE', 'WARRANTY', 'SUPPORT']) kind!: string;
  @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsInt({ each: true }) @Min(0, { each: true }) @Max(365, { each: true }) reminderDays?: number[];
  @IsOptional() @IsUUID() responsibleUserId?: string | null;
  @IsOptional() @IsUUID() responsibleGroupId?: string | null;
}
export class UpdateLifecycleDateDto {
  @IsOptional() @IsIn(['LICENSE', 'WARRANTY', 'SUPPORT']) kind?: string;
  @IsOptional() @IsDateString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsInt({ each: true }) @Min(0, { each: true }) @Max(365, { each: true }) reminderDays?: number[];
  @IsOptional() @IsUUID() responsibleUserId?: string | null;
  @IsOptional() @IsUUID() responsibleGroupId?: string | null;
}

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
  @IsOptional() device?: unknown;
  @IsOptional() nativeVlan?: unknown;
  @IsOptional() accessVlan?: unknown;
  @IsOptional() allowedVlans?: unknown;
  @IsOptional() ipAddresses?: unknown;
}

export class UpdatePortLayoutDto {
  @IsOptional() @IsInt() @Min(1) imageWidth?: number;
  @IsOptional() @IsInt() @Min(1) imageHeight?: number;
  @IsOptional() @IsArray() ports?: unknown[];
  @IsOptional() viewport?: unknown;
  @IsOptional() confidence?: number;
  @IsOptional() confirmedAt?: string;
  @IsOptional() confirmedBy?: string;
  @IsOptional() warnings?: unknown;
  @IsOptional() @IsString() assetId?: string;
  /** Optional: when given, a stale value gets 409 PORT_LAYOUT_CONFLICT. */
  @IsOptional() @IsString() revision?: string;
}

/** PUT device-models/:id/port-layout/faces. Required fields are checked in the service so errors carry a code. */
export class SavePortLayoutFacesDto {
  @IsOptional() @IsString() revision?: string;
  @IsOptional() @IsObject() faces?: Record<string, unknown>;
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
export class UpdateRackDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() roomId!: string;
}
/** Rack creation also sets up its PDUs. Power changes after creation go through PUT racks/:id/pdus. */
export class CreateRackDto extends UpdateRackDto {
  /** Default SUPPLIER_ONLY ("Só rede elétrica"). SUPPLIER_AND_UPS ("Rede + UPS") also creates a UPS PDU. */
  @IsOptional() @IsIn(RACK_POWER_MODES as unknown as string[]) powerMode?: RackPowerMode;
  @IsOptional() @ValidateNested() @Type(() => PduSettingsDto) supplierPdu?: PduSettingsDto;
  @IsOptional() @ValidateNested() @Type(() => PduSettingsDto) upsPdu?: PduSettingsDto;
}
export class ReorderRacksDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) rackIds!: string[];
}
export class PlaceDeviceDto {
  @IsString() @MinLength(1) rackId!: string;
  @IsInt() @Min(1) rackUnitStart!: number;
}

export class CreateBuildingDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
}
export class UpdateBuildingDto extends CreateBuildingDto {}
export class CreateRoomDto {
  @IsString() @MinLength(1) name!: string;
}
export class UpdateRoomDto extends CreateRoomDto {}

export class CreateInfrastructurePermissionDto {
  @IsUUID() groupId!: string;
  @IsIn(['SITE', 'BUILDING', 'ROOM']) scopeType!: string;
  @IsUUID() scopeId!: string;
  @IsIn(['READ', 'CREATE', 'UPDATE', 'DELETE']) permission!: string;
}
export class UpdateInfrastructurePermissionDto extends CreateInfrastructurePermissionDto {}

export class CreateAssetDto {
  @IsString() @MinLength(1) filename!: string;
  @IsString() mimeType!: string;
  @IsString() @MinLength(1) kind!: string;
  @IsOptional() @IsString() license?: string;
  @IsString() @MinLength(1) contentBase64!: string;
}
