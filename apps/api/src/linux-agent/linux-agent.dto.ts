import { IsString, MaxLength, MinLength } from 'class-validator';

export class EnrollLinuxAgentDto {
  @IsString() @MinLength(1) @MaxLength(80) hostId!: string;
}

export class LinuxHeartbeatDto {
  @IsString() @MinLength(1) @MaxLength(255) hostname!: string;
  @IsString() @MinLength(1) @MaxLength(100) os!: string;
  @IsString() @MaxLength(100) osVersion!: string;
  @IsString() @MaxLength(40) agentVersion!: string;
}
