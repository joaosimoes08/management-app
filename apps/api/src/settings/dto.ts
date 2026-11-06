import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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

export class UpdateSnmpListenerDto {
  @IsBoolean() listenAll!: boolean;
  @IsArray() @ArrayMaxSize(64) @IsUUID('4', { each: true }) interfaceIds!: string[];
}

export class UpdateUserRolesDto {
  @IsArray() @ArrayMaxSize(APPLICATION_ROLES.length) @IsIn(APPLICATION_ROLES, { each: true }) roles!: ApplicationRole[];
}

export class DirectoryGroupRoleMappingDto {
  @IsString() @MinLength(1) @MaxLength(120) groupName!: string;
  @IsIn(APPLICATION_ROLES) appRole!: ApplicationRole;
}

export class UpdateDirectoryFederationDto {
  @IsString() @IsIn(['ad', 'other']) vendor!: 'ad' | 'other';
  @IsString() @MaxLength(300) connectionUrl!: string;
  @IsString() @MinLength(1) @MaxLength(300) bindDn!: string;
  @IsOptional() @IsString() @MaxLength(500) bindCredential?: string;
  @IsString() @MinLength(1) @MaxLength(500) usersDn!: string;
  @IsString() @IsIn(['uid', 'cn', 'sAMAccountName', 'userPrincipalName']) usernameLdapAttribute!: string;
  @IsString() @MinLength(1) @MaxLength(500) groupsDn!: string;
  @IsString() @IsIn(['cn', 'sAMAccountName']) groupNameLdapAttribute!: string;
  @IsString() @IsIn(['groupOfNames', 'groupOfUniqueNames', 'group']) groupObjectClass!: string;
  @IsString() @IsIn(['member', 'uniqueMember', 'memberUid']) membershipLdapAttribute!: string;
  @IsArray() @ArrayMaxSize(APPLICATION_ROLES.length * 4) @ValidateNested({ each: true }) @Type(() => DirectoryGroupRoleMappingDto) groupRoleMappings!: DirectoryGroupRoleMappingDto[];
}

export class CreateAccessGroupDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) siteIds?: string[];
}

export class UpdateAccessGroupDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
}
export class AccessGroupMemberDto { @IsUUID() userId!: string; }
export class UpdateAccessGroupSiteDto {
  @IsArray() @ArrayMaxSize(6) @IsIn(['READ', 'CREATE', 'UPDATE', 'DELETE', 'DISCOVER', 'IMPORT'], { each: true }) permissions!: string[];
}
