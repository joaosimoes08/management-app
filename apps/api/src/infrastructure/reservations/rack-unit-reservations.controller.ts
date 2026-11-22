import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.service';
import { Roles } from '../../auth/roles.decorator';
import { CreateRackUnitReservationDto } from './dto';
import { RackUnitReservationsService } from './rack-unit-reservations.service';

/** Round 2 #18: rack U-space reservations. Read: same as GET racks/:id. Writes: ADMIN / SYSTEMS_OPERATOR, same as rack edits. */
@ApiTags('infrastructure') @ApiBearerAuth()
@Controller({ version: '1' })
export class RackUnitReservationsController {
  constructor(private readonly reservations: RackUnitReservationsService) {}
  @Get('racks/:id/unit-reservations') list(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) { return this.reservations.list(id, req.user); }
  @Post('racks/:id/unit-reservations') @Roles('ADMIN', 'SYSTEMS_OPERATOR') create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRackUnitReservationDto, @Req() req: { user: AuthenticatedUser }) { return this.reservations.create(id, dto, req.user); }
  @Delete('racks/:id/unit-reservations/:reservationId') @Roles('ADMIN', 'SYSTEMS_OPERATOR') release(@Param('id', ParseUUIDPipe) id: string, @Param('reservationId', ParseUUIDPipe) reservationId: string, @Req() req: { user: AuthenticatedUser }) { return this.reservations.release(id, reservationId, req.user); }
}
