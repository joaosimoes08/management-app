import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ChangeEntityType } from '@simoes/database';

export class ChangePlanItemDto {
  @IsEnum(ChangeEntityType) entityType!: ChangeEntityType;
  @IsUUID() entityId!: string;
  @IsString() @MinLength(2) @MaxLength(240) operationSummary!: string;
  @IsOptional() @IsObject() currentValue?: Record<string, unknown>;
  @IsOptional() @IsObject() proposedValue?: Record<string, unknown>;
}

export class CreateChangePlanDto {
  @IsUUID() siteId!: string;
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsDateString() plannedStartAt!: string;
  @IsDateString() plannedEndAt!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ChangePlanItemDto) items!: ChangePlanItemDto[];
}

export class UpdateChangePlanDto {
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) reason?: string;
  @IsOptional() @IsDateString() plannedStartAt?: string;
  @IsOptional() @IsDateString() plannedEndAt?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ChangePlanItemDto) items?: ChangePlanItemDto[];
}

export class ReviewChangePlanDto {
  @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(1000) reviewNote?: string;
}

export class StartChangePlanDto {
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CloseChangePlanDto {
  @IsIn(['COMPLETED', 'FAILED', 'ROLLED_BACK']) status!: 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
  @IsOptional() @IsString() @MaxLength(2000) closingNote?: string;
}

export class AddChecklistItemsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @MinLength(2, { each: true }) @MaxLength(240, { each: true }) labels!: string[];
}

export class TickChecklistItemDto {
  @IsBoolean() done!: boolean;
}

export class LinkSnmpWriteDto {
  @IsUUID() snmpWriteRequestId!: string;
}
