import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { CreateAssetDto, CreateBuildingDto, CreateDeviceDto, CreateDeviceModelDto, CreateInterfaceDto, CreateRackDto, CreateRackModelDto, CreateRoomDto, DetectPortLayoutDto, ReorderRacksDto, UpdateBuildingDto, UpdateDeviceDto, UpdateDeviceModelDto, UpdateInterfaceDto, UpdatePortLayoutDto, UpdateRackDto, UpdateRackModelDto, UpdateRoomDto } from './dto';
import { InfrastructureService } from './infrastructure.service';

@ApiTags('infrastructure') @ApiBearerAuth()
@Controller({ version: '1' })
export class InfrastructureController {
  constructor(private readonly service: InfrastructureService) {}
  @Get('assets') assets(@Query('kind') kind?: string) { return this.service.listAssets(kind); }
  @Post('assets') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createAsset(@Body() dto: CreateAssetDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createAsset(dto, req.user); }
  @Get('assets/:id/file') async assetFile(@Param('id') id: string, @Res({ passthrough: true }) reply: any) { const result = await this.service.assetFile(id); reply.type(result.asset.mimeType); return result.file; }
  @Delete('assets/:id') @Roles('ADMIN') deleteAsset(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteAsset(id, req.user); }
  @Post('assets/cleanup-legacy') @Roles('ADMIN') cleanupLegacyAssets(@Req() req: { user: AuthenticatedUser }) { return this.service.cleanupLegacyAssets(req.user); }
  @Get('rack-models') rackModels() { return this.service.listRackModels(); }
  @Post('rack-models') @Roles('ADMIN') createRackModel(@Body() dto: CreateRackModelDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createRackModel(dto, req.user); }
  @Patch('rack-models/:id') @Roles('ADMIN') updateRackModel(@Param('id') id: string, @Body() dto: UpdateRackModelDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateRackModel(id, dto, req.user); }
  @Delete('rack-models/:id') @Roles('ADMIN') deleteRackModel(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteRackModel(id, req.user); }
  @Get('sites/:siteId/racks') siteRacks(@Param('siteId') siteId: string) { return this.service.listRacks(siteId); }
  @Get('sites/:siteId/locations') locations(@Param('siteId') siteId: string) { return this.service.listLocations(siteId); }
  @Get('sites/:siteId/buildings') buildings(@Param('siteId') siteId: string) { return this.service.listBuildings(siteId); }
  @Post('sites/:siteId/buildings') @Roles('ADMIN', 'SYSTEMS_OPERATOR') createBuilding(@Param('siteId') siteId: string, @Body() dto: CreateBuildingDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createBuilding(siteId, dto, req.user); }
  @Patch('buildings/:id') @Roles('ADMIN', 'SYSTEMS_OPERATOR') updateBuilding(@Param('id') id: string, @Body() dto: UpdateBuildingDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateBuilding(id, dto, req.user); }
  @Delete('buildings/:id') @Roles('ADMIN', 'SYSTEMS_OPERATOR') deleteBuilding(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteBuilding(id, req.user); }
  @Get('buildings/:buildingId/rooms') rooms(@Param('buildingId') buildingId: string) { return this.service.listRooms(buildingId); }
  @Post('buildings/:buildingId/rooms') @Roles('ADMIN', 'SYSTEMS_OPERATOR') createRoom(@Param('buildingId') buildingId: string, @Body() dto: CreateRoomDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createRoom(buildingId, dto, req.user); }
  @Patch('rooms/:id') @Roles('ADMIN', 'SYSTEMS_OPERATOR') updateRoom(@Param('id') id: string, @Body() dto: UpdateRoomDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateRoom(id, dto, req.user); }
  @Delete('rooms/:id') @Roles('ADMIN', 'SYSTEMS_OPERATOR') deleteRoom(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteRoom(id, req.user); }
  @Get('racks') racks(@Query('siteId') siteId?: string) { return this.service.listRacks(siteId); }
  @Get('racks/:id') rack(@Param('id') id: string) { return this.service.getRack(id); }
  @Post('racks') @Roles('ADMIN', 'SYSTEMS_OPERATOR') createRack(@Body() dto: CreateRackDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createRack(dto, req.user); }
  @Patch('rooms/:roomId/racks/order') @Roles('ADMIN', 'SYSTEMS_OPERATOR') reorderRacks(@Param('roomId') roomId: string, @Body() dto: ReorderRacksDto, @Req() req: { user: AuthenticatedUser }) { return this.service.reorderRacks(roomId, dto, req.user); }
  @Patch('racks/:id') @Roles('ADMIN', 'SYSTEMS_OPERATOR') updateRack(@Param('id') id: string, @Body() dto: UpdateRackDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateRack(id, dto, req.user); }
  @Delete('racks/:id') @Roles('ADMIN', 'SYSTEMS_OPERATOR') deleteRack(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteRack(id, req.user); }
  @Get('device-models') models(@Query('search') search?: string, @Query('type') type?: string, @Query('supportsNetworkPorts') supportsNetworkPorts?: string) { return this.service.listModels(search, type, supportsNetworkPorts); }
  @Get('device-models/:id') model(@Param('id') id: string) { return this.service.getModel(id); }
  @Get('device-models/:id/port-layout') portLayout(@Param('id') id: string) { return this.service.getPortLayout(id); }
  @Patch('device-models/:id/port-layout') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') updatePortLayout(@Param('id') id: string, @Body() dto: UpdatePortLayoutDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updatePortLayout(id, dto, req.user); }
  @Post('device-models/:id/port-layout/generate') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') generatePortLayout(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.generatePortLayout(id, req.user); }
  @Post('device-models/:id/assets/front') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') setModelFrontAsset(@Param('id') id: string, @Body('assetId') assetId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.setModelFrontAsset(id, assetId, req.user); }
  @Post('device-models/:id/port-layout/detect') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') detectPortLayout(@Param('id') id: string, @Body() dto: DetectPortLayoutDto) { return this.service.detectPortLayout(id, dto); }
  @Post('device-models') @Roles('ADMIN', 'NETWORK_OPERATOR') createModel(@Body() dto: CreateDeviceModelDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createModel(dto, req.user); }
  @Post('device-models/seed') @Roles('ADMIN') seedCatalog(@Req() req: { user: AuthenticatedUser }) { return this.service.seedCatalog(req.user); }
  @Patch('device-models/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateModel(@Param('id') id: string, @Body() dto: UpdateDeviceModelDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateModel(id, dto, req.user); }
  @Delete('device-models/:id') @Roles('ADMIN') deleteModel(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteModel(id, req.user); }
  @Get('devices') devices(@Query('search') search?: string, @Query('type') type?: string, @Query('siteId') siteId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.listDevices(search, type, siteId, page, pageSize); }
  @Get('devices/:id') device(@Param('id') id: string) { return this.service.getDevice(id); }
  @Post('devices') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createDevice(@Body() dto: CreateDeviceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createDevice(dto, req.user); }
  @Patch('devices/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') updateDevice(@Param('id') id: string, @Body() dto: UpdateDeviceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateDevice(id, dto, req.user); }
  @Delete('devices/:id') @Roles('ADMIN') deleteDevice(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteDevice(id, req.user); }
  @Get('interfaces') interfaces(@Query('deviceId') deviceId?: string, @Query('search') search?: string) { return this.service.listInterfaces(deviceId, search); }
  @Get('interfaces/:id') deviceInterface(@Param('id') id: string) { return this.service.getInterface(id); }
  @Post('devices/:deviceId/interfaces') @Roles('ADMIN', 'NETWORK_OPERATOR') createInterface(@Param('deviceId') deviceId: string, @Body() dto: CreateInterfaceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.createInterface(deviceId, dto, req.user); }
  @Post('devices/:deviceId/interfaces/generate') @Roles('ADMIN', 'NETWORK_OPERATOR') generateInterfaces(@Param('deviceId') deviceId: string, @Req() req: { user: AuthenticatedUser }) { return this.service.generateInterfaces(deviceId, req.user); }
  @Patch('interfaces/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') updateInterface(@Param('id') id: string, @Body() dto: UpdateInterfaceDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateInterface(id, dto, req.user); }
  @Delete('interfaces/:id') @Roles('ADMIN', 'NETWORK_OPERATOR') deleteInterface(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.deleteInterface(id, req.user); }
}
