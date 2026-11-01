import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordBackupCheckDto {
  @IsIn(['BACKUP_COMPLETED', 'RESTORE_VERIFIED', 'RESTORE_FAILED']) kind!: string;
  @IsDateString() completedAt!: string;
  @IsOptional() @IsString() @MaxLength(500) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
