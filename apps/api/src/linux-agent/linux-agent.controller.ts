import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
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
  @Get('hosts') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  inventory(@Req() req: { user: AuthenticatedUser }, @Query('siteId', new ParseUUIDPipe({ optional: true })) siteId?: string) {
    return this.service.inventory(req.user, siteId);
  }
  @Get('hosts/:hostId/services') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY')
  services(@Param('hostId', ParseUUIDPipe) hostId: string, @Req() req: { user: AuthenticatedUser }) {
    return this.service.services(hostId, req.user);
  }
  @Header('Cache-Control', 'no-store')
  @Post('enrollments') @Roles('ADMIN') enroll(@Body() dto: EnrollLinuxAgentDto, @Req() req: { user: AuthenticatedUser }) { return this.service.enroll(dto, req.user); }
  @Delete(':id') @Roles('ADMIN') revoke(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.revoke(id, req.user); }
  @Public() @Post('heartbeat') @HttpCode(200) heartbeat(@Headers('authorization') authorization: string | undefined, @Body() dto: LinuxHeartbeatDto) { return this.service.heartbeat(authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined, dto); }
}
