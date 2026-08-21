import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { CalculatorDto, CreateDiscoveryJobDto, CreateHostDto, CreateIpDto, CreateIpamGroupDto, CreateIpamPermissionDto, CreateNatRuleDto, CreateServiceDto, CreateSiteDto, CreateSubnetDto, CreateVlanDto, CreateVrfDto, RipeImportDto, RipePreviewDto, ReviewDiscoveryResultDto, UpdateDiscoveryScheduleDto, UpdateHostDto, UpdateIpDto, UpdateIpamPermissionDto, UpdateNatRuleDto, UpdateSiteDto, UpdateSubnetDto, UpdateSubnetScanDto, UpdateVlanDto, UpdateVrfDto } from './dto';
import { IpamService } from './ipam.service';
import { IpamAdvancedService } from './ipam-advanced.service';

@ApiTags('ipam') @ApiBearerAuth() @Controller({ version: '1' })
export class IpamController {
  constructor(private readonly service: IpamService, private readonly advanced: IpamAdvancedService) {}
  @Get('sites') sites(@Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listSites(search, page, pageSize); }
  @Get('sites/:siteId/network-map') networkMap(@Param('siteId') siteId: string) { return this.service.networkMap(siteId); }
  @Post('sites') @Roles('ADMIN', 'NETWORK_OPERATOR') createSite(@Body() dto: CreateSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createSite(dto, req.user); }
  @Patch('sites/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSite(@Param('id') id: string, @Body() dto: UpdateSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateSite(id, dto, req.user); }
  @Delete('sites/:id') @Roles('ADMIN') deleteSite(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteSite(id, req.user); }
  @Get('vlans') vlans(@Query('siteId') siteId?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listVlans(siteId, search, page, pageSize); }
  @Post('vlans') @Roles('ADMIN', 'NETWORK_OPERATOR') createVlan(@Body() dto: CreateVlanDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createVlan(dto, req.user); }
  @Patch('vlans/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateVlan(@Param('id') id: string, @Body() dto: UpdateVlanDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateVlan(id, dto, req.user); }
  @Delete('vlans/:id') @Roles('ADMIN') deleteVlan(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteVlan(id, req.user); }
  @Get('subnets') subnets(@Query('siteId') siteId?: string, @Query('vlanId') vlanId?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listSubnets(siteId, vlanId, search, page, pageSize); }
  @Post('subnets') @Roles('ADMIN', 'NETWORK_OPERATOR') createSubnet(@Body() dto: CreateSubnetDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createSubnet(dto, req.user); }
  @Patch('subnets/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSubnet(@Param('id') id: string, @Body() dto: UpdateSubnetDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateSubnet(id, dto, req.user); }
  @Delete('subnets/:id') @Roles('ADMIN') deleteSubnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteSubnet(id, req.user); }
  @Get('subnets/:id') subnet(@Param('id') id: string) { return this.advanced.getSubnet(id); }
  @Get('subnets/:id/usage') subnetUsage(@Param('id') id: string) { return this.advanced.subnetUsage(id); }
  @Get('subnets/:id/tree') subnetTree(@Param('id') id: string) { return this.advanced.subnetTree(id); }
  @Patch('subnets/:id/scan-config') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSubnetScan(@Param('id') id: string, @Body() dto: UpdateSubnetScanDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateSubnetScan(id, dto, req.user); }
  @Post('subnets/:id/scan') @Roles('ADMIN', 'NETWORK_OPERATOR') scanSubnet(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.scanSubnet(id, req.user); }
  @Get('ip-addresses') ips(@Query('subnetId') subnetId?: string, @Query('state') state?: string, @Query('source') source?: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listIps(subnetId, state, source, search, page, pageSize); }
  @Post('ip-addresses') @Roles('ADMIN', 'NETWORK_OPERATOR') createIp(@Body() dto: CreateIpDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createIp(dto, req.user); }
  @Patch('ip-addresses/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateIp(@Param('id') id: string, @Body() dto: UpdateIpDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateIp(id, dto, req.user); }
  @Delete('ip-addresses/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteIp(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteIp(id, req.user); }
  @Get('ip-addresses/:id') ip(@Param('id') id: string) { return this.advanced.getIp(id); }
  @Post('ip-addresses/:id/check') @Roles('ADMIN', 'NETWORK_OPERATOR') checkIp(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.checkIp(id, req.user); }
  @Get('hosts') hosts(@Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listHosts(search, page, pageSize); }
  @Post('hosts') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createHost(@Body() dto: CreateHostDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createHost(dto, req.user); }
  @Patch('hosts/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') updateHost(@Param('id') id: string, @Body() dto: UpdateHostDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateHost(id, dto, req.user); }
  @Get('hosts/:id/services') services(@Param('id') hostId: string) { return this.service.listServices(hostId); }
  @Post('services') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createService(@Body() dto: CreateServiceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createService(dto, req.user); }
  @Get('vrfs') vrfs(@Query('siteId') siteId?: string, @Query('search') search?: string) { return this.advanced.listVrfs(siteId, search); }
  @Get('vrfs/:id') vrf(@Param('id') id: string) { return this.advanced.getVrf(id); }
  @Post('vrfs') @Roles('ADMIN', 'NETWORK_OPERATOR') createVrf(@Body() dto: CreateVrfDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createVrf(dto, req.user); }
  @Patch('vrfs/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateVrf(@Param('id') id: string, @Body() dto: UpdateVrfDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateVrf(id, dto, req.user); }
  @Delete('vrfs/:id') @Roles('ADMIN') deleteVrf(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteVrf(id, req.user); }
  @Get('nat-rules') natRules(@Query('siteId') siteId?: string, @Query('vrfId') vrfId?: string, @Query('type') type?: string, @Query('search') search?: string) { return this.advanced.listNatRules(siteId, vrfId, type, search); }
  @Get('nat-rules/:id') natRule(@Param('id') id: string) { return this.advanced.getNatRule(id); }
  @Post('nat-rules') @Roles('ADMIN', 'NETWORK_OPERATOR') createNatRule(@Body() dto: CreateNatRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createNatRule(dto, req.user); }
  @Patch('nat-rules/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateNatRule(@Param('id') id: string, @Body() dto: UpdateNatRuleDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateNatRule(id, dto, req.user); }
  @Delete('nat-rules/:id') @Roles('ADMIN') deleteNatRule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteNatRule(id, req.user); }
  @Post('ipam/calculator') calculator(@Body() dto: CalculatorDto) { return this.advanced.calculator(dto); }
  @Get('ipam/groups') groups(@Query('siteId') siteId?: string) { return this.advanced.listIpamGroups(siteId); }
  @Post('ipam/groups') @Roles('ADMIN') createGroup(@Body() dto: CreateIpamGroupDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createIpamGroup(dto, req.user); }
  @Post('ipam/permissions') @Roles('ADMIN') createPermission(@Body() dto: CreateIpamPermissionDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.createIpamPermission(dto, req.user); }
  @Patch('ipam/permissions/:id') @Roles('ADMIN') updatePermission(@Param('id') id: string, @Body() dto: UpdateIpamPermissionDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.updateIpamPermission(id, dto, req.user); }
  @Delete('ipam/permissions/:id') @Roles('ADMIN') deletePermission(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.advanced.deleteIpamPermission(id, req.user); }
  @Post('ipam/ripe/preview') @Roles('ADMIN', 'NETWORK_OPERATOR') ripePreview(@Body() dto: RipePreviewDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.ripePreview(dto, req.user); }
  @Post('ipam/ripe/import') @Roles('ADMIN', 'NETWORK_OPERATOR') ripeImport(@Body() dto: RipeImportDto, @Req() req: { user: AuthenticatedUser }) { return this.advanced.importRipe(dto, req.user); }
  @Get('ipam/ripe/imports') ripeImports() { return this.advanced.listRipeImports(); }
  @Get('ipam/ripe/imports/:id') ripeImportDetail(@Param('id') id: string) { return this.advanced.getRipeImport(id); }
  @Get('discovery/summary') discoverySummary() { return this.service.discoverySummary(); }
  @Get('discovery/jobs') jobs(@Query('status') status?: string, @Query('subnetId') subnetId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listDiscoveryJobs(status, subnetId, page, pageSize); }
  @Get('discovery/jobs/:id') job(@Param('id') id: string) { return this.service.getDiscoveryJob(id); }
  @Get('discovery/jobs/:id/results') results(@Param('id') id: string) { return this.service.listDiscoveryResults(id); }
  @Post('discovery/jobs') @Roles('ADMIN', 'NETWORK_OPERATOR') createJob(@Body() dto: CreateDiscoveryJobDto, @Req() req: { user: AuthenticatedUser }) { return this.service.runDiscovery(dto, req.user); }
  @Get('subnets/:id/discovery-schedule') schedule(@Param('id') id: string) { return this.service.getDiscoverySchedule(id); }
  @Patch('subnets/:id/discovery-schedule') @Roles('ADMIN', 'NETWORK_OPERATOR') updateSchedule(@Param('id') id: string, @Body() dto: UpdateDiscoveryScheduleDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateDiscoverySchedule(id, dto, req.user); }
  @Post('subnets/:id/discovery-schedule/run') @Roles('ADMIN', 'NETWORK_OPERATOR') runSchedule(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.runScheduledDiscovery(id, req.user); }
  @Post('discovery/results/:id/review') @Roles('ADMIN', 'NETWORK_OPERATOR') review(@Param('id') id: string, @Body() dto: ReviewDiscoveryResultDto, @Req() req: { user: AuthenticatedUser }) { return this.service.reviewResult(id, dto, req.user); }
}
