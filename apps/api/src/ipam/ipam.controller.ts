import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { CalculatorDto, CreateDiscoveryJobDto, CreateHostDto, CreateIpDto, CreateIpamGroupDto, CreateIpamPermissionDto, CreateNatRuleDto, CreateServiceDto, CreateSiteDto, CreateSubnetDto, CreateVlanDto, CreateVrfDto, IpamGroupMemberDto, RipeImportDto, RipePreviewDto, ReviewDiscoveryResultDto, UpdateDiscoveryScheduleDto, UpdateHostDto, UpdateIpDto, UpdateIpamGroupDto, UpdateIpamPermissionDto, UpdateNatRuleDto, UpdateServiceDto, UpdateSiteDto, UpdateSubnetDto, UpdateSubnetScanDto, UpdateVlanDto, UpdateVrfDto } from './dto';
import { IpamService } from './ipam.service';
import { IpamAdvancedService } from './ipam-advanced.service';

@ApiTags('ipam') @ApiBearerAuth() @Controller({ version: '1' })
export class IpamController {
  constructor(private readonly service: IpamService, private readonly advanced: IpamAdvancedService) {}
  @Get('sites') sites(@Req() req: { user: AuthenticatedUser }, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listSites(req.user, search, page, pageSize); }
  @Get('sites/:siteId/network-map') networkMap(@Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.networkMap(req.user, siteId); }
  @Post('sites') @Roles('ADMIN', 'NETWORK_OPERATOR') createSite(@Body() dto: CreateSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createSite(dto, req.user); }
  @Patch('sites/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSite(@Param('id') id: string, @Body() dto: UpdateSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateSite(id, dto, req.user); }
  @Delete('sites/:id') @Roles('ADMIN') deleteSite(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteSite(id, req.user); }
  @Get('vlans') vlans(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listVlans(req.user, siteId, search, page, pageSize); }
  @Post('vlans') @Roles('ADMIN', 'NETWORK_OPERATOR') createVlan(@Body() dto: CreateVlanDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createVlan(dto, req.user); }
  @Patch('vlans/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateVlan(@Param('id') id: string, @Body() dto: UpdateVlanDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateVlan(id, dto, req.user); }
  @Delete('vlans/:id') @Roles('ADMIN') deleteVlan(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteVlan(id, req.user); }
  @Get('subnets') subnets(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('vlanId') vlanId?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listSubnets(req.user, siteId, vlanId, search, page, pageSize); }
  @Post('subnets') @Roles('ADMIN', 'NETWORK_OPERATOR') createSubnet(@Body() dto: CreateSubnetDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createSubnet(dto, req.user); }
  @Patch('subnets/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSubnet(@Param('id') id: string, @Body() dto: UpdateSubnetDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateSubnet(id, dto, req.user); }
  @Delete('subnets/:id') @Roles('ADMIN') deleteSubnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteSubnet(id, req.user); }
  @Get('subnets/:id') subnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getSubnet(id, req.user); }
  @Get('subnets/:id/usage') subnetUsage(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.subnetUsage(id, req.user); }
  @Get('subnets/:id/tree') subnetTree(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.subnetTree(id, req.user); }
  @Patch('subnets/:id/scan-config') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSubnetScan(@Param('id') id: string, @Body() dto: UpdateSubnetScanDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateSubnetScan(id, dto, req.user); }
  @Post('subnets/:id/scan') @Roles('ADMIN', 'NETWORK_OPERATOR') scanSubnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.scanSubnet(id, req.user); }
  @Get('ip-addresses') ips(@Req() req: { user: AuthenticatedUser }, @Query('subnetId') subnetId?: string, @Query('state') state?: string, @Query('source') source?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listIps(req.user, subnetId, state, source, search, page, pageSize); }
  @Post('ip-addresses') @Roles('ADMIN', 'NETWORK_OPERATOR') createIp(@Body() dto: CreateIpDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createIp(dto, req.user); }
  @Patch('ip-addresses/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateIp(@Param('id') id: string, @Body() dto: UpdateIpDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateIp(id, dto, req.user); }
  @Delete('ip-addresses/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteIp(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteIp(id, req.user); }
  @Get('ip-addresses/:id') ip(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getIp(id, req.user); }
  @Post('ip-addresses/:id/check') @Roles('ADMIN', 'NETWORK_OPERATOR') checkIp(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.checkIp(id, req.user); }
  @Get('hosts') hosts(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('vlanId') vlanId?: string, @Query('subnetId') subnetId?: string, @Query('state') state?: string, @Query('source') source?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listHosts(req.user, siteId, vlanId, subnetId, state, source, search, page, pageSize); }
  @Get('hosts/:id') host(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.getHost(req.user, id); }
  @Post('hosts') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createHost(@Body() dto: CreateHostDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createHost(dto, req.user); }
  @Patch('hosts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') updateHost(@Param('id') id: string, @Body() dto: UpdateHostDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateHost(id, dto, req.user); }
  @Delete('hosts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') retireHost(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.retireHost(id, req.user); }
  @Post('hosts/:id/ip-addresses/:ipId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') linkHostIp(@Param('id') id: string, @Param('ipId') ipId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.linkHostIp(id, ipId, req.user); }
  @Delete('hosts/:id/ip-addresses/:ipId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') unlinkHostIp(@Param('id') id: string, @Param('ipId') ipId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.unlinkHostIp(id, ipId, req.user); }
  @Post('hosts/:id/device/:deviceId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') linkHostDevice(@Param('id') id: string, @Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.linkHostDevice(id, deviceId, req.user); }
  @Delete('hosts/:id/device') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') unlinkHostDevice(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.unlinkHostDevice(id, req.user); }
  @Get('hosts/:id/services') services(@Param('id') hostId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.listServices(req.user, hostId); }
  @Post('services') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createService(@Body() dto: CreateServiceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createService(dto, req.user); }
  @Patch('services/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') updateService(@Param('id') id: string, @Body() dto: UpdateServiceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateService(id, dto, req.user); }
  @Delete('services/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') deleteService(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteService(id, req.user); }
  @Get('vrfs') vrfs(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('search') search?: string) { return this.advanced.listVrfs(req.user, siteId, search); }
  @Get('vrfs/:id') vrf(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getVrf(id, req.user); }
  @Post('vrfs') @Roles('ADMIN', 'NETWORK_OPERATOR') createVrf(@Body() dto: CreateVrfDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createVrf(dto, req.user); }
  @Patch('vrfs/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateVrf(@Param('id') id: string, @Body() dto: UpdateVrfDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateVrf(id, dto, req.user); }
  @Delete('vrfs/:id') @Roles('ADMIN') deleteVrf(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteVrf(id, req.user); }
  @Get('nat-rules') natRules(@Req() req: { user: AuthenticatedUser }, @Query('siteId') siteId?: string, @Query('vrfId') vrfId?: string, @Query('type') type?: string, @Query('search') search?: string) { return this.advanced.listNatRules(req.user, siteId, vrfId, type, search); }
  @Get('nat-rules/:id') natRule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.getNatRule(id, req.user); }
  @Post('nat-rules') @Roles('ADMIN', 'NETWORK_OPERATOR') createNatRule(@Body() dto: CreateNatRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createNatRule(dto, req.user); }
  @Patch('nat-rules/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateNatRule(@Param('id') id: string, @Body() dto: UpdateNatRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateNatRule(id, dto, req.user); }
  @Delete('nat-rules/:id') @Roles('ADMIN') deleteNatRule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteNatRule(id, req.user); }
  @Post('ipam/calculator') calculator(@Body() dto: CalculatorDto) { return this.advanced.calculator(dto); }
  @Get('ipam/groups') @Roles('ADMIN') groups(@Query('siteId') siteId?: string) { return this.advanced.listIpamGroups(siteId); }
  @Post('ipam/groups') @Roles('ADMIN') createGroup(@Body() dto: CreateIpamGroupDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createIpamGroup(dto, req.user); }
  @Patch('ipam/groups/:id') @Roles('ADMIN') updateGroup(@Param('id') id: string, @Body() dto: UpdateIpamGroupDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateIpamGroup(id, dto, req.user); }
  @Delete('ipam/groups/:id') @Roles('ADMIN') deleteGroup(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteIpamGroup(id, req.user); }
  @Get('ipam/users') @Roles('ADMIN') ipamUsers(@Query('search') search?: string) { return this.advanced.listIpamUsers(search); }
  @Post('ipam/groups/:id/members') @Roles('ADMIN') addGroupMember(@Param('id') id: string, @Body() dto: IpamGroupMemberDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.addIpamGroupMember(id, dto.userId, req.user); }
  @Delete('ipam/groups/:id/members/:userId') @Roles('ADMIN') removeGroupMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.removeIpamGroupMember(id, userId, req.user); }
  @Post('ipam/permissions') @Roles('ADMIN') createPermission(@Body() dto: CreateIpamPermissionDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createIpamPermission(dto, req.user); }
  @Patch('ipam/permissions/:id') @Roles('ADMIN') updatePermission(@Param('id') id: string, @Body() dto: UpdateIpamPermissionDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateIpamPermission(id, dto, req.user); }
  @Delete('ipam/permissions/:id') @Roles('ADMIN') deletePermission(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteIpamPermission(id, req.user); }
  @Post('ipam/ripe/preview') @Roles('ADMIN', 'NETWORK_OPERATOR') ripePreview(@Body() dto: RipePreviewDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.ripePreview(dto, req.user); }
  @Post('ipam/ripe/import') @Roles('ADMIN', 'NETWORK_OPERATOR') ripeImport(@Body() dto: RipeImportDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.importRipe(dto, req.user); }
  @Get('ipam/ripe/imports') ripeImports() { return this.advanced.listRipeImports(); }
  @Get('ipam/ripe/imports/:id') ripeImportDetail(@Param('id') id: string) { return this.advanced.getRipeImport(id); }
  @Get('discovery/summary') discoverySummary(@Req() req: { user: AuthenticatedUser }) { return this.service.discoverySummary(req.user); }
  @Get('discovery/jobs') jobs(@Req() req: { user: AuthenticatedUser }, @Query('status') status?: string, @Query('subnetId') subnetId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listDiscoveryJobs(req.user, status, subnetId, page, pageSize); }
  @Get('discovery/jobs/:id') job(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.getDiscoveryJob(req.user, id); }
  @Get('discovery/jobs/:id/results') results(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.listDiscoveryResults(req.user, id); }
  @Post('discovery/jobs') @Roles('ADMIN', 'NETWORK_OPERATOR') createJob(@Body() dto: CreateDiscoveryJobDto, @Req() req: { user: AuthenticatedUser }) { return this.service.runDiscovery(dto, req.user); }
  @Get('subnets/:id/discovery-schedule') schedule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.getDiscoverySchedule(req.user, id); }
  @Patch('subnets/:id/discovery-schedule') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSchedule(@Param('id') id: string, @Body() dto: UpdateDiscoveryScheduleDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateDiscoverySchedule(id, dto, req.user); }
  @Post('subnets/:id/discovery-schedule/run') @Roles('ADMIN', 'NETWORK_OPERATOR') runSchedule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.runScheduledDiscovery(id, req.user); }
  @Post('discovery/results/:id/review') @Roles('ADMIN', 'NETWORK_OPERATOR') review(@Param('id') id: string, @Body() dto: ReviewDiscoveryResultDto, @Req() req: { user: AuthenticatedUser }) { return this.service.reviewResult(id, dto, req.user); }
}
