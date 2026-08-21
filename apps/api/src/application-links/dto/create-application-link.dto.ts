import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator';
import { APPLICATION_ROLES } from '../../auth/roles';

export class CreateApplicationLinkDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;

  @IsOptional() @IsString() @MaxLength(40)
  icon?: string;

  @IsOptional() @IsString() @MaxLength(240)
  description?: string;

  @IsOptional() @IsString() @MaxLength(50)
  category?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsBoolean()
  checkAvailability?: boolean;

  @IsOptional() @IsArray() @IsIn(APPLICATION_ROLES, { each: true })
  roles?: string[];
}
