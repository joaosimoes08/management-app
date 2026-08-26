import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class OrganizationDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(30)
  code?: string;

  @IsOptional() @IsIn(['Europe/Lisbon', 'UTC', 'Europe/London', 'Europe/Madrid'])
  timezone?: string;

  @IsOptional() @IsIn(['pt-PT', 'en-US'])
  locale?: string;
}
