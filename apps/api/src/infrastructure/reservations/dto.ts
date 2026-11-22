import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** POST /api/v1/racks/:id/unit-reservations — hold U-space for a planned install. */
export class CreateRackUnitReservationDto {
  @IsInt() @Min(1) @Max(60) startUnit!: number;
  @IsInt() @Min(1) @Max(60) size!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  /** Optional end of the hold (ISO date); omitted = until released. */
  @IsOptional() @IsDateString() expiresAt?: string;
}
