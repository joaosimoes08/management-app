import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { CalculatorDto, CreateDiscoveryJobDto, CreateHostDto, CreateIpDto, CreateIpReservationDto, CreateNatRuleDto, CreateServiceDto, CreateSiteDto, CreateSubnetDto, CreateVlanDto, CreateVrfDto, RipeImportDto, RipePreviewDto, ReviewDiscoveryResultDto, ReserveNextIpsDto, BulkReviewDiscoveryResultsDto, UpdateDiscoveryScheduleDto, UpdateHostDto, UpdateIpDto, UpdateNatRuleDto, UpdateServiceDto, UpdateSiteDto, UpdateSubnetDto, UpdateSubnetScanDto, UpdateVlanDto, UpdateVrfDto } from './dto';
import { IpamService } from './ipam.service';
import { IpamAdvancedService } from './ipam-advanced.service';
import { IpReservationService } from './ip-reservation.service';
import { SubnetCapacityService } from './subnet-capacity.service';
import { IpamWorkflowsService } from './ipam-workflows.service';
import { IpDriftService } from './ip-drift.service';
import { CommitSubnetPlanDto, MarkMissingIpsFreeDto, MissingIpsQueryDto } from './dto';

@ApiTags('ipam') @ApiBearerAuth() @Controller({ version: '1' })
export class IpamController {
  constructor(private readonly service: IpamService, private readonly advanced: IpamAdvancedService, private readonly reservations: IpReservationService, private readonly capacity: SubnetCapacityService, private readonly workflows: IpamWorkflowsService, private readonly drift: IpDriftService) {}
  @Post('ip-reservations') @Roles('ADMIN', 'NETWORK_OPERATOR') createIpReservation(@Body() dto: CreateIpReservationDto, @Req() req: { user: AuthenticatedUser }) { return this.reservations.create(dto, req.user); }
  @Post('ip-reservations/:id/release') @Roles('ADMIN', 'NETWORK_OPERATOR') releaseIpReservation(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.reservations.release(id, req.user); }
  @Get('sites') sites(@Req() req: { user: AuthenticatedUser }, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listSites(req.user, search, page, pageSize); }
  @Get('sites/:siteId/network-map') networkMap(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.networkMap(req.user, siteId); }
  @Post('sites') @Roles('ADMIN') createSite(@Body() dto: CreateSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createSite(dto, req.user); }
  @Patch('sites/:id') @Roles('ADMIN') updateSite(@Param('id') id: string, @Body() dto: UpdateSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateSite(id, dto, req.user); }
  @Delete('sites/:id') @Roles('ADMIN') deleteSite(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteSite(id, req.user); }
  @Get('vlans') vlans(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listVlans(req.user, siteId, search, page, pageSize); }
  @Post('vlans') @Roles('ADMIN', 'NETWORK_OPERATOR') createVlan(@Body() dto: CreateVlanDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createVlan(dto, req.user); }
  @Patch('vlans/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateVlan(@Param('id') id: string, @Body() dto: UpdateVlanDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateVlan(id, dto, req.user); }
  @Delete('vlans/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteVlan(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteVlan(id, req.user); }
  @Get('subnets') subnets(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('vlanId') vlanId?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('band') band?: string, @Query('minUtilization') minUtilization?: string, @Query('sort') sort?: string, @Query('tag') tag?: string) { return this.service.listSubnets(req.user, siteId, vlanId, search, page, pageSize, { band, minUtilization, sort, tag }); }
  @Post('subnets') @Roles('ADMIN', 'NETWORK_OPERATOR') createSubnet(@Body() dto: CreateSubnetDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createSubnet(dto, req.user); }
  @Patch('subnets/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSubnet(@Param('id') id: string, @Body() dto: UpdateSubnetDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateSubnet(id, dto, req.user); }
  @Delete('subnets/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteSubnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteSubnet(id, req.user); }
  @Get('subnets/:id') subnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getSubnet(id, req.user); }
  @Get('subnets/:id/usage') subnetUsage(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.capacity.usage(id, req.user); }
  @Get('subnets/:id/capacity-history') subnetCapacityHistory(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.capacity.history(id, req.user); }
  @Get('subnets/:id/next-free') nextFreeIps(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }, @Query('count') count?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.workflows.nextFree(req.user, id, { count, from, to }); }
  @Post('subnets/:id/reserve-next') @Roles('ADMIN', 'NETWORK_OPERATOR') reserveNextIps(@Param('id') id: string, @Body() dto: ReserveNextIpsDto, @Req() req: { user: AuthenticatedUser }) { return this.workflows.reserveNext(req.user, id, dto); }
  @Get('subnets/:id/planning') subnetPlanning(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }, @Query('prefix') prefix?: string, @Query('count') count?: string) { return this.advanced.subnetPlanning(id, req.user, prefix, count); }
  @Post('subnets/:id/planning/commit') @Roles('ADMIN', 'NETWORK_OPERATOR') commitSubnetPlanning(@Param('id') id: string, @Body() body: CommitSubnetPlanDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.commitPlanning(id, body.blocks, req.user); }
  @Get('subnets/:id/tree') subnetTree(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.subnetTree(id, req.user); }
  @Patch('subnets/:id/scan-config') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSubnetScan(@Param('id') id: string, @Body() dto: UpdateSubnetScanDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateSubnetScan(id, dto, req.user); }
  @Post('subnets/:id/scan') @Roles('ADMIN', 'NETWORK_OPERATOR') scanSubnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.scanSubnet(id, req.user); }
  @Get('ip-addresses') ips(@Req() req: { user: AuthenticatedUser }, @Query('subnetId') subnetId?: string, @Query('state') state?: string, @Query('source') source?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listIps(req.user, subnetId, state, source, search, page, pageSize); }
  @Post('ip-addresses') @Roles('ADMIN', 'NETWORK_OPERATOR') createIp(@Body() dto: CreateIpDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createIp(dto, req.user); }
  @Patch('ip-addresses/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateIp(@Param('id') id: string, @Body() dto: UpdateIpDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateIp(id, dto, req.user); }
  @Delete('ip-addresses/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteIp(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteIp(id, req.user); }
  @Get('ip-addresses/:id') ip(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getIp(id, req.user); }
  @Get('ip-addresses/:id/check-history') ipCheckHistory(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.advanced.getIpCheckHistory(id, req.user, page, pageSize); }
  @Post('ip-addresses/:id/check') @Roles('ADMIN', 'NETWORK_OPERATOR') checkIp(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.checkIp(id, req.user); }
  @Get('hosts') hosts(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('vlanId') vlanId?: string, @Query('subnetId') subnetId?: string, @Query('state') state?: string, @Query('source') source?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listHosts(req.user, siteId, vlanId, subnetId, state, source, search, page, pageSize); }
  @Get('hosts/:id') host(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.getHost(req.user, id); }
  @Post('hosts') @Roles('ADMIN', 'NETWORK_OPERATOR') createHost(@Body() dto: CreateHostDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createHost(dto, req.user); }
  @Patch('hosts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateHost(@Param('id') id: string, @Body() dto: UpdateHostDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateHost(id, dto, req.user); }
  @Delete('hosts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') retireHost(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.retireHost(id, req.user); }
  @Post('hosts/:id/ip-addresses/:ipId') @Roles('ADMIN', 'NETWORK_OPERATOR') linkHostIp(@Param('id') id: string, @Param('ipId') ipId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.linkHostIp(id, ipId, req.user); }
  @Delete('hosts/:id/ip-addresses/:ipId') @Roles('ADMIN', 'NETWORK_OPERATOR') unlinkHostIp(@Param('id') id: string, @Param('ipId') ipId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.unlinkHostIp(id, ipId, req.user); }
  @Post('hosts/:id/device/:deviceId') @Roles('ADMIN', 'NETWORK_OPERATOR') linkHostDevice(@Param('id') id: string, @Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.linkHostDevice(id, deviceId, req.user); }
  @Delete('hosts/:id/device') @Roles('ADMIN', 'NETWORK_OPERATOR') unlinkHostDevice(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.unlinkHostDevice(id, req.user); }
  @Get('hosts/:id/services') services(@Param('id') hostId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.listServices(req.user, hostId); }
  @Post('services') @Roles('ADMIN', 'NETWORK_OPERATOR') createService(@Body() dto: CreateServiceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createService(dto, req.user); }
  @Patch('services/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateService(@Param('id') id: string, @Body() dto: UpdateServiceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateService(id, dto, req.user); }
  @Delete('services/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteService(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteService(id, req.user); }
  @Get('vrfs') vrfs(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('search') search?: string) { return this.advanced.listVrfs(req.user, siteId, search); }
  @Get('vrfs/:id') vrf(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getVrf(id, req.user); }
  @Post('vrfs') @Roles('ADMIN', 'NETWORK_OPERATOR') createVrf(@Body() dto: CreateVrfDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createVrf(dto, req.user); }
  @Patch('vrfs/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateVrf(@Param('id') id: string, @Body() dto: UpdateVrfDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateVrf(id, dto, req.user); }
  @Delete('vrfs/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteVrf(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteVrf(id, req.user); }
  @Get('nat-rules') natRules(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('vrfId') vrfId?: string, @Query('type') type?: string, @Query('search') search?: string) { return this.advanced.listNatRules(req.user, siteId, vrfId, type, search); }
  @Get('nat-rules/:id') natRule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getNatRule(id, req.user); }
  @Post('nat-rules') @Roles('ADMIN', 'NETWORK_OPERATOR') createNatRule(@Body() dto: CreateNatRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createNatRule(dto, req.user); }
  @Patch('nat-rules/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateNatRule(@Param('id') id: string, @Body() dto: UpdateNatRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateNatRule(id, dto, req.user); }
  @Delete('nat-rules/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteNatRule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteNatRule(id, req.user); }
  @Post('ipam/calculator') calculator(@Body() dto: CalculatorDto) { return this.advanced.calculator(dto); }
  @Post('ipam/ripe/preview') @Roles('ADMIN', 'NETWORK_OPERATOR') ripePreview(@Body() dto: RipePreviewDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.ripePreview(dto, req.user); }
  @Post('ipam/ripe/import') @Roles('ADMIN', 'NETWORK_OPERATOR') ripeImport(@Body() dto: RipeImportDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.importRipe(dto, req.user); }
  @Get('ipam/ripe/imports') @Roles('ADMIN', 'NETWORK_OPERATOR') ripeImports(@Req() req: { user: AuthenticatedUser }) { return this.advanced.listRipeImports(req.user); }
  @Get('ipam/ripe/imports/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') ripeImportDetail(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getRipeImport(id, req.user); }
  @Get('discovery/summary') discoverySummary(@Req() req: { user: AuthenticatedUser }) { return this.service.discoverySummary(req.user); }
  @Get('discovery/missing') missingIps(@Query() query: MissingIpsQueryDto, @Req() req: { user: AuthenticatedUser }) { return this.drift.listMissing(req.user, query); }
  @Post('discovery/missing/mark-free') @Roles('ADMIN', 'NETWORK_OPERATOR') markMissingFree(@Body() dto: MarkMissingIpsFreeDto, @Req() req: { user: AuthenticatedUser }) { return this.drift.markFree(req.user, dto.ipIds); }
  @Get('discovery/jobs') jobs(@Req() req: { user: AuthenticatedUser }, @Query('status') status?: string, @Query('subnetId') subnetId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listDiscoveryJobs(req.user, status, subnetId, page, pageSize); }
  @Get('discovery/jobs/:id') job(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.getDiscoveryJob(req.user, id); }
  @Get('discovery/jobs/:id/results') results(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.listDiscoveryResults(req.user, id); }
  @Get('discovery/jobs/:id/compare') compareJobs(@Param('id') id: string, @Query('with') previousId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.compareDiscoveryJobs(req.user, id, previousId); }
  @Post('discovery/jobs/:id/cancel') @Roles('ADMIN', 'NETWORK_OPERATOR') cancelJob(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.cancelDiscoveryJob(req.user, id); }
  @Post('discovery/jobs/:id/retry') @Roles('ADMIN', 'NETWORK_OPERATOR') retryJob(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.retryDiscoveryJob(req.user, id); }
  @Post('discovery/jobs') @Roles('ADMIN', 'NETWORK_OPERATOR') createJob(@Body() dto: CreateDiscoveryJobDto, @Req() req: { user: AuthenticatedUser }) { return this.service.runDiscovery(dto, req.user); }
  @Get('subnets/:id/discovery-schedule') schedule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.getDiscoverySchedule(req.user, id); }
  @Patch('subnets/:id/discovery-schedule') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSchedule(@Param('id') id: string, @Body() dto: UpdateDiscoveryScheduleDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateDiscoverySchedule(id, dto, req.user); }
  @Post('subnets/:id/discovery-schedule/run') @Roles('ADMIN', 'NETWORK_OPERATOR') runSchedule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.runScheduledDiscovery(id, req.user); }
  @Post('discovery/results/bulk-review') @Roles('ADMIN', 'NETWORK_OPERATOR') bulkReview(@Body() dto: BulkReviewDiscoveryResultsDto, @Req() req: { user: AuthenticatedUser }) { return this.workflows.bulkReview(req.user, dto); }
  @Post('discovery/results/:id/review') @Roles('ADMIN', 'NETWORK_OPERATOR') review(@Param('id') id: string, @Body() dto: ReviewDiscoveryResultDto, @Req() req: { user: AuthenticatedUser }) { return this.service.reviewResult(id, dto, req.user); }
}
