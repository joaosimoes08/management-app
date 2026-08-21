import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class InitialSiteDto {
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @IsString() @MinLength(2) @MaxLength(30)
  code!: string;

  @IsOptional() @IsString() @MaxLength(180)
  address?: string;

  @IsOptional() @IsString() @MaxLength(80)
  city?: string;

  @IsOptional() @IsString() @MaxLength(80)
  region?: string;

  @IsOptional() @IsString() @MaxLength(80)
  country?: string;

  @IsOptional() @IsString() @MaxLength(100)
  buildingName?: string;

  @IsOptional() @IsString() @MaxLength(100)
  roomName?: string;

  @IsOptional() @IsString() @MaxLength(100)
  rackName?: string;
}
