import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

export enum TopologyMapTypeDto { PHYSICAL = 'PHYSICAL', NETWORK = 'NETWORK', VLAN_SUBNET = 'VLAN_SUBNET' }
export enum DeviceConnectionTypeDto { PHYSICAL = 'PHYSICAL', LOGICAL = 'LOGICAL' }

export class ListTopologyMapsQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsEnum(TopologyMapTypeDto) type?: TopologyMapTypeDto;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
export class ListDeviceConnectionsQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsEnum(DeviceConnectionTypeDto) type?: DeviceConnectionTypeDto;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export class CreateTopologyMapDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsEnum(TopologyMapTypeDto) type!: TopologyMapTypeDto;
  @IsUUID() siteId!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsObject() viewport?: Record<string, unknown>;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
}
export class UpdateTopologyMapDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(TopologyMapTypeDto) type?: TopologyMapTypeDto;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsObject() viewport?: Record<string, unknown>;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
  @IsOptional() @IsNumber() expectedRevision?: number;
}
export class TopologyNodePositionDto { @IsNumber() x!: number; @IsNumber() y!: number; }
export class TopologyMapNodeDto {
  @IsUUID() deviceId!: string;
  @IsOptional() @IsNumber() x?: number;
  @IsOptional() @IsNumber() y?: number;
}
export class BulkTopologyNodesDto { @IsArray() @ValidateNested({ each: true }) @Type(() => TopologyMapNodeDto) nodes!: TopologyMapNodeDto[]; @IsNumber() revision!: number; }
export class CreateTopologyConnectionDto {
  @IsUUID() sourceDeviceId!: string;
  @IsUUID() targetDeviceId!: string;
  @IsOptional() @IsUUID() sourceInterfaceId?: string;
  @IsOptional() @IsUUID() targetInterfaceId?: string;
  @IsOptional() @IsEnum(DeviceConnectionTypeDto) type?: DeviceConnectionTypeDto;
  @IsOptional() @IsString() @MaxLength(240) label?: string;
  @IsOptional() @IsNumber() revision?: number;
}
export class CreateDeviceConnectionDto {
  @IsUUID() siteId!: string;
  @IsUUID() sourceDeviceId!: string;
  @IsUUID() targetDeviceId!: string;
  @IsOptional() @IsUUID() sourceInterfaceId?: string;
  @IsOptional() @IsUUID() targetInterfaceId?: string;
  @IsOptional() @IsEnum(DeviceConnectionTypeDto) type?: DeviceConnectionTypeDto;
  @IsOptional() @IsString() @MaxLength(240) label?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateDeviceConnectionDto {
  @IsOptional() @IsEnum(DeviceConnectionTypeDto) type?: DeviceConnectionTypeDto;
  @IsOptional() @IsString() @MaxLength(240) label?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsObject() expectedRevisions?: Record<string, number>;
}
export class AssociateTopologyConnectionDto { @IsOptional() @IsNumber() revision?: number; }
