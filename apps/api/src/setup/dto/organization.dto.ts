import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsIanaTimeZone } from '../../common/time-zone';
import { SUPPORTED_LOCALES } from '../../common/locales';

export class OrganizationDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(30)
  code?: string;

  @IsOptional() @IsIanaTimeZone()
  timezone?: string;

  @IsOptional() @IsIn(SUPPORTED_LOCALES)
  locale?: string;
}
