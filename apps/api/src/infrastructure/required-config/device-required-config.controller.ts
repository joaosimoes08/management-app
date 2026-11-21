import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.service';
import { requiredConfigRegistry } from './device-required-config';
import { DeviceRequiredConfigService } from './device-required-config.service';

/** Required device configurations: registry, missing-config groups and affected devices. Contract: docs/device-required-config.md. */
@ApiTags('infrastructure') @ApiBearerAuth()
@Controller({ version: '1' })
export class DeviceRequiredConfigController {
  constructor(private readonly requiredConfig: DeviceRequiredConfigService) {}
  /** Registry of settings tabs and required configs (static). */
  @Get('devices/required-configs') registry() { return requiredConfigRegistry(); }
  /** One group per missing FEATURE config, scoped to devices the user can see and manage. */
  @Get('devices/missing-config/summary') summary(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.requiredConfig.missingSummary(req.user, siteId); }
  /** Devices missing one FEATURE config (config=rearImage|power), paginated, each with its settings href. */
  @Get('devices/missing-config') list(@Req() req: { user: AuthenticatedUser }, @Query('config') config?: string, @Query('siteId') siteId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.requiredConfig.listMissing(req.user, config, siteId, page, pageSize); }
}
