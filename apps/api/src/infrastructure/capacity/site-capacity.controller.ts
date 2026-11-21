import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../auth/auth.service';
import { parseThresholds } from '../power/power-summary';
import { SiteCapacityService } from './site-capacity.service';

@ApiTags('infrastructure') @ApiBearerAuth()
@Controller({ version: '1' })
export class SiteCapacityController {
  constructor(private readonly capacity: SiteCapacityService) {}

  @Get('sites/:siteId/capacity-outlook')
  outlook(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() req: { user: AuthenticatedUser },
    @Query('warningPercent') warning?: string,
    @Query('criticalPercent') critical?: string,
  ) {
    return this.capacity.outlook(siteId, req.user, parseThresholds(warning, critical));
  }
}
