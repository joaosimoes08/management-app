import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SnmpCredentialPurpose } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AcceptSnmpEnrollmentDto, AcknowledgeSnmpWriteImpactDto, CreateSnmpCredentialDto, CreateSnmpTrapEnrollmentDto, CreateSnmpWritePreviewDto, IgnoreUnmatchedTrapsDto, ReviewSnmpDriftDto, BulkReviewSnmpDriftsDto, SnmpOnboardingDeviceDto, UpsertSnmpConfigDto, UpsertSnmpHealthThresholdsDto } from './dto';
import { SnmpService } from './snmp.service';
import { TopologyReconciliationService } from './topology-reconciliation.service';
import { SnmpFleetService } from './snmp-fleet.service';
import { SnmpHealthThresholdsService } from './snmp-health-thresholds.service';

@ApiTags('snmp') @ApiBearerAuth() @Controller({ path: 'snmp', version: '1' })
export class SnmpController {
  constructor(private readonly service: SnmpService, private readonly reconciliation: TopologyReconciliationService, private readonly fleet: SnmpFleetService, private readonly healthThresholds: SnmpHealthThresholdsService) {}
  @Get('fleet/summary') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') fleetSummary(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string) { return this.fleet.fleetSummary(req.user, siteId); }
  @Get('drifts') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') drifts(@Req() req: { user: AuthenticatedUser }, @Query('status') status?: string, @Query('siteId') siteId?: string, @Query('deviceId') deviceId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.fleet.listDrifts(req.user, { status, siteId, deviceId, page, pageSize }); }
  @Post('drifts/bulk-review') @Roles('ADMIN', 'NETWORK_OPERATOR') bulkReviewDrifts(@Body() dto: BulkReviewSnmpDriftsDto, @Req() req: { user: AuthenticatedUser }) { return this.fleet.bulkReview(req.user, dto); }
  @Get('devices/:deviceId/topology-proposals') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') proposals(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.reconciliation.list(deviceId, req.user); }
  @Get('devices/:deviceId/lldp-observations') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') lldpObservations(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.reconciliation.observations(deviceId, req.user); }
  @Post('topology-proposals/:id/apply') @Roles('ADMIN', 'NETWORK_OPERATOR') applyProposal(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.reconciliation.apply(id, req.user); }
  @Post('topology-proposals/:id/reject') @Roles('ADMIN', 'NETWORK_OPERATOR') rejectProposal(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.reconciliation.reject(id, req.user); }
  @Post('topology-proposals/:id/undo') @Roles('ADMIN', 'NETWORK_OPERATOR') undoProposal(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.reconciliation.undo(id, req.user); }
  @Get('traps/unmatched') @Roles('ADMIN') unmatchedTraps() { return this.service.unmatchedTraps(); }
  @Get('traps/unmatched/sources') @Roles('ADMIN') unmatchedTrapSources() { return this.service.unmatchedTrapSources(); }
  @Post('traps/unmatched/ignore') @Roles('ADMIN') ignoreUnmatchedTraps(@Body() dto: IgnoreUnmatchedTrapsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.ignoreUnmatchedTraps(dto.sourceAddress, req.user); }
  @Get('devices/:deviceId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') overview(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.overview(deviceId, req.user); }
  @Get('devices/:deviceId/health') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') health(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.health(deviceId, req.user); }
  // SNMP Phase 2 step 9: health alert limits (per Site / per Device) and the 30-day health history.
  @Get('health-thresholds/defaults') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') healthThresholdDefaults() { return this.healthThresholds.defaults(); }
  @Get('sites/:siteId/health-thresholds') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') siteHealthThresholds(@Param('siteId', ParseUUIDPipe) siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.healthThresholds.site(req.user, siteId); }
  @Put('sites/:siteId/health-thresholds') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSiteHealthThresholds(@Param('siteId', ParseUUIDPipe) siteId: string, @Body() dto: UpsertSnmpHealthThresholdsDto, @Req() req: { user: AuthenticatedUser }) { return this.healthThresholds.updateSite(req.user, siteId, dto); }
  @Get('devices/:deviceId/health-thresholds') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') deviceHealthThresholds(@Param('deviceId', ParseUUIDPipe) deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.healthThresholds.device(req.user, deviceId); }
  @Put('devices/:deviceId/health-thresholds') @Roles('ADMIN', 'NETWORK_OPERATOR') updateDeviceHealthThresholds(@Param('deviceId', ParseUUIDPipe) deviceId: string, @Body() dto: UpsertSnmpHealthThresholdsDto, @Req() req: { user: AuthenticatedUser }) { return this.healthThresholds.updateDevice(req.user, deviceId, dto); }
  @Get('devices/:deviceId/health/history') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') healthHistory(@Param('deviceId', ParseUUIDPipe) deviceId: string, @Query('hours') hours: string | undefined, @Req() req: { user: AuthenticatedUser }) { return this.healthThresholds.history(req.user, deviceId, hours); }
  @Get('devices/:deviceId/metrics') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') metrics(@Param('deviceId') deviceId: string, @Query('interfaceIndex') interfaceIndex: string | undefined, @Query('days') days: string | undefined, @Req() req: { user: AuthenticatedUser }) { return this.service.metrics(deviceId, req.user, interfaceIndex === undefined ? undefined : Number(interfaceIndex), days === undefined ? 7 : Number(days)); }
  @Patch('devices/:deviceId/config') @Roles('ADMIN') config(@Param('deviceId') deviceId: string, @Body() dto: UpsertSnmpConfigDto, @Req() req: { user: AuthenticatedUser }) { return this.service.upsertConfig(deviceId, dto, req.user); }
  @Post('devices/:deviceId/credentials') @Roles('ADMIN') credential(@Param('deviceId') deviceId: string, @Body() dto: CreateSnmpCredentialDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createCredential(deviceId, dto, req.user); }
  @Delete('devices/:deviceId/credentials/:purpose') @Roles('ADMIN') deleteCredential(@Param('deviceId') deviceId: string, @Param('purpose') purpose: SnmpCredentialPurpose, @Req() req: { user: AuthenticatedUser }, @Query('force') force?: string) { return this.service.deleteCredential(deviceId, purpose, req.user, parseForce(force)); }
  @Post('devices/:deviceId/credentials/:purpose/test') @Roles('ADMIN') testCredential(@Param('deviceId') deviceId: string, @Param('purpose') purpose: SnmpCredentialPurpose, @Req() req: { user: AuthenticatedUser }) { return this.service.testCredential(deviceId, purpose, req.user); }
  @Post('devices/:deviceId/poll') @Roles('ADMIN', 'NETWORK_OPERATOR') poll(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.poll(deviceId, req.user); }
  @Patch('drifts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') reviewDrift(@Param('id') id: string, @Body() dto: ReviewSnmpDriftDto, @Req() req: { user: AuthenticatedUser }) { return this.service.reviewDrift(id, dto, req.user); }
  @Post('devices/:deviceId/write-requests/preview') @Roles('ADMIN') previewWrite(@Param('deviceId') deviceId: string, @Body() dto: CreateSnmpWritePreviewDto, @Req() req: { user: AuthenticatedUser }) { return this.service.previewWrite(deviceId, dto, req.user); }
  @Post('write-requests/:id/execute') @Roles('ADMIN') executeWrite(@Param('id') id: string, @Body() dto: AcknowledgeSnmpWriteImpactDto, @Req() req: { user: AuthenticatedUser }) { return this.service.executeWrite(id, dto, req.user); }
  @Post('credentials/rotate') @Roles('ADMIN') rotate(@Req() req: { user: AuthenticatedUser }) { return this.service.rotateCredentials(req.user); }
  @Get('discovery/enrollments') @Roles('ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY') enrollments(@Query('siteId') siteId: string | undefined, @Req() req: { user: AuthenticatedUser }) { return this.service.listEnrollments(req.user, siteId); }
  @Post('discovery/enrollments') @Roles('ADMIN') createEnrollment(@Body() dto: CreateSnmpTrapEnrollmentDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createEnrollment(dto, req.user); }
  @Post('discovery/enrollments/:id/renew') @Roles('ADMIN') renewEnrollment(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.renewEnrollment(id, req.user); }
  @Delete('discovery/enrollments/:id') @Roles('ADMIN') deleteEnrollment(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteEnrollment(id, req.user); }
  @Post('discovery/enrollments/:id/accept') @Roles('ADMIN', 'NETWORK_OPERATOR') acceptEnrollment(@Param('id') id: string, @Body() dto: AcceptSnmpEnrollmentDto, @Req() req: { user: AuthenticatedUser }) { return this.service.acceptEnrollment(id, dto, req.user); }
  @Post('onboarding/devices') @Roles('ADMIN') onboardDevice(@Body() dto: SnmpOnboardingDeviceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.onboardDevice(dto, req.user); }
}

/** Fix F2: `?force=true` confirms deleting a credential that is in use; only true/false are accepted. */
export function parseForce(value?: string) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException({ code: 'SNMP_FORCE_INVALID', message: 'force deve ser true ou false.' });
}
