import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { EnrollLinuxAgentDto, LinuxHeartbeatDto } from './linux-agent.dto';
import { LinuxAgentService } from './linux-agent.service';

@ApiTags('linux-agent') @ApiBearerAuth() @Controller({ path: 'linux-agents', version: '1' })
export class LinuxAgentController {
  constructor(private readonly service: LinuxAgentService) {}
  @Get() @Roles('ADMIN', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') list(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.service.list(req.user, siteId); }
  @Post('enrollments') @Roles('ADMIN') enroll(@Body() dto: EnrollLinuxAgentDto, @Req() req: { user: AuthenticatedUser }) { return this.service.enroll(dto, req.user); }
  @Delete(':id') @Roles('ADMIN') revoke(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.revoke(id, req.user); }
  @Public() @Post('heartbeat') heartbeat(@Headers('authorization') authorization: string | undefined, @Body() dto: LinuxHeartbeatDto) { return this.service.heartbeat(authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined, dto); }
}
