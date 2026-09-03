import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SnmpCredentialPurpose } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AcceptSnmpEnrollmentDto, CreateSnmpCredentialDto, CreateSnmpTrapEnrollmentDto, CreateSnmpWritePreviewDto, ReviewSnmpDriftDto, SnmpOnboardingDeviceDto, UpsertSnmpConfigDto } from './dto';
import { SnmpService } from './snmp.service';

@ApiTags('snmp') @ApiBearerAuth() @Controller({ path: 'snmp', version: '1' })
export class SnmpController {
  constructor(private readonly service: SnmpService) {}
  @Get('traps/unmatched') @Roles('ADMIN') unmatchedTraps() { return this.service.unmatchedTraps(); }
  @Get('devices/:deviceId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') overview(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.overview(deviceId, req.user); }
  @Patch('devices/:deviceId/config') @Roles('ADMIN') config(@Param('deviceId') deviceId: string, @Body() dto: UpsertSnmpConfigDto, @Req() req: { user: AuthenticatedUser }) { return this.service.upsertConfig(deviceId, dto, req.user); }
  @Post('devices/:deviceId/credentials') @Roles('ADMIN') credential(@Param('deviceId') deviceId: string, @Body() dto: CreateSnmpCredentialDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createCredential(deviceId, dto, req.user); }
  @Delete('devices/:deviceId/credentials/:purpose') @Roles('ADMIN') deleteCredential(@Param('deviceId') deviceId: string, @Param('purpose') purpose: SnmpCredentialPurpose, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteCredential(deviceId, purpose, req.user); }
  @Post('devices/:deviceId/credentials/:purpose/test') @Roles('ADMIN') testCredential(@Param('deviceId') deviceId: string, @Param('purpose') purpose: SnmpCredentialPurpose, @Req() req: { user: AuthenticatedUser }) { return this.service.testCredential(deviceId, purpose, req.user); }
  @Post('devices/:deviceId/poll') @Roles('ADMIN', 'NETWORK_OPERATOR') poll(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.poll(deviceId, req.user); }
  @Patch('drifts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') reviewDrift(@Param('id') id: string, @Body() dto: ReviewSnmpDriftDto, @Req() req: { user: AuthenticatedUser }) { return this.service.reviewDrift(id, dto, req.user); }
  @Post('devices/:deviceId/write-requests/preview') @Roles('ADMIN') previewWrite(@Param('deviceId') deviceId: string, @Body() dto: CreateSnmpWritePreviewDto, @Req() req: { user: AuthenticatedUser }) { return this.service.previewWrite(deviceId, dto, req.user); }
  @Post('write-requests/:id/execute') @Roles('ADMIN') executeWrite(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.executeWrite(id, req.user); }
  @Post('credentials/rotate') @Roles('ADMIN') rotate(@Req() req: { user: AuthenticatedUser }) { return this.service.rotateCredentials(req.user); }
  @Get('discovery/enrollments') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') enrollments(@Query('siteId') siteId: string | undefined, @Req() req: { user: AuthenticatedUser }) { return this.service.listEnrollments(req.user, siteId); }
  @Post('discovery/enrollments') @Roles('ADMIN') createEnrollment(@Body() dto: CreateSnmpTrapEnrollmentDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createEnrollment(dto, req.user); }
  @Post('discovery/enrollments/:id/renew') @Roles('ADMIN') renewEnrollment(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.renewEnrollment(id, req.user); }
  @Delete('discovery/enrollments/:id') @Roles('ADMIN') deleteEnrollment(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteEnrollment(id, req.user); }
  @Post('discovery/enrollments/:id/accept') @Roles('ADMIN', 'NETWORK_OPERATOR') acceptEnrollment(@Param('id') id: string, @Body() dto: AcceptSnmpEnrollmentDto, @Req() req: { user: AuthenticatedUser }) { return this.service.acceptEnrollment(id, dto, req.user); }
  @Post('onboarding/devices') @Roles('ADMIN') onboardDevice(@Body() dto: SnmpOnboardingDeviceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.onboardDevice(dto, req.user); }
}
