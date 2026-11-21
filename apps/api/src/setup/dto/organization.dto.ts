import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsIanaTimeZone } from '../../common/time-zone';

export class OrganizationDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(30)
  code?: string;

  @IsOptional() @IsIanaTimeZone()
  timezone?: string;

  @IsOptional() @IsIn(['pt-PT', 'en-US'])
  locale?: string;
}
