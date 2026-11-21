import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MAX_PDU_OUTLET_COUNT, MAX_POWER_PLUG_COUNT, MAX_WATTS, MIN_POWER_PLUG_COUNT } from './power-defaults';
import { RACK_POWER_MODES, type RackPowerMode } from './rack-power';

/** Optional per-PDU settings. Omitted field = keep current value (or the default on creation). `null` clears name/budget. */
export class PduSettingsDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_PDU_OUTLET_COUNT) outletCount?: number;
  /** null = no budget (no watt warnings for this PDU). */
  @IsOptional() @IsInt() @Min(0) @Max(MAX_WATTS) budgetWatts?: number | null;
}

/** PUT /api/v1/racks/:id/pdus — power mode plus optional per-PDU settings. */
export class RackPowerDto {
  @IsIn(RACK_POWER_MODES as unknown as string[]) mode!: RackPowerMode;
  @IsOptional() @ValidateNested() @Type(() => PduSettingsDto) supplier?: PduSettingsDto;
  /** Ignored when mode is SUPPLIER_ONLY. */
  @IsOptional() @ValidateNested() @Type(() => PduSettingsDto) ups?: PduSettingsDto;
}

export class PlugAssignmentDto {
  @IsInt() @Min(1) @Max(MAX_POWER_PLUG_COUNT) plugIndex!: number;
  /** PDU of the device's rack; null = "Não ligado". */
  @IsOptional() @IsString() pduId?: string | null;
  /** Omit or null to auto-pick the lowest free outlet. */
  @IsOptional() @IsInt() @Min(1) @Max(MAX_PDU_OUTLET_COUNT) outletIndex?: number | null;
}

/**
 * PUT /api/v1/devices/:id/power — replaces ALL of the device's outlet assignments in one transaction.
 * - powerPlugCount / estimatedWatts: omitted = unchanged, null = fall back to model → default.
 * - plugs omitted: default distribution (all on Rede; on Rede + UPS plugs alternate Rede/UPS).
 * - plugs: [] disconnects every plug. Plugs not listed stay "Não ligado".
 */
export class DevicePowerDto {
  @IsOptional() @IsInt() @Min(MIN_POWER_PLUG_COUNT) @Max(MAX_POWER_PLUG_COUNT) powerPlugCount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_WATTS) estimatedWatts?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_POWER_PLUG_COUNT) @ValidateNested({ each: true }) @Type(() => PlugAssignmentDto) plugs?: PlugAssignmentDto[];
}
