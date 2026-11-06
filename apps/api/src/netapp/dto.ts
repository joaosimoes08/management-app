import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class UpsertNetAppIntegrationDto {
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false }) @MaxLength(2048) endpointUrl!: string;
  @IsString() @MinLength(1) @MaxLength(255) username!: string;
  @IsString() @MinLength(1) @MaxLength(255) password!: string;
}
