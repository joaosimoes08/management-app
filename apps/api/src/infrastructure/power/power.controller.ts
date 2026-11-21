import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.service';
import { Roles } from '../../auth/roles.decorator';
import { DevicePowerDto, RackPowerDto } from './dto';
import { powerDefaults } from './power-defaults';
import { RackPowerService } from './rack-power.service';

/** Rack PDUs, outlet assignments and wattage estimates. Writes: ADMIN / SYSTEMS_OPERATOR, same as rack edits. */
@ApiTags('infrastructure') @ApiBearerAuth()
@Controller({ version: '1' })
export class PowerController {
  constructor(private readonly power: RackPowerService) {}
  @Get('power/defaults') defaults() { return powerDefaults(); }
  @Put('racks/:id/pdus') @Roles('ADMIN', 'SYSTEMS_OPERATOR') updateRackPdus(@Param('id') id: string, @Body() dto: RackPowerDto, @Req() req: { user: AuthenticatedUser }) { return this.power.updateRackPdus(id, dto, req.user); }
  @Put('devices/:id/power') @Roles('ADMIN', 'SYSTEMS_OPERATOR') updateDevicePower(@Param('id') id: string, @Body() dto: DevicePowerDto, @Req() req: { user: AuthenticatedUser }) { return this.power.updateDevicePower(id, dto, req.user); }
  @Delete('racks/:rackId/pdus/:pduId/devices/:deviceId') @Roles('ADMIN', 'SYSTEMS_OPERATOR') disconnectDevice(@Param('rackId') rackId: string, @Param('pduId') pduId: string, @Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.power.disconnectDevice(rackId, pduId, deviceId, req.user); }
}
