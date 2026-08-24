import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  summary() { return this.service.summary(); }

  @Get('search')
  search(@Query('q') query: string | undefined, @Query('limit') limit: string | undefined, @Req() request: { user: AuthenticatedUser }) {
    return this.service.search(query, limit, request.user);
  }

  @Get('topbar-state')
  topbarState() { return this.service.topbarState(); }
}
