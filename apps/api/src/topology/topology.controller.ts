import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AssociateTopologyConnectionDto, BulkTopologyNodesDto, CreateDeviceConnectionDto, CreateTopologyConnectionDto, CreateTopologyMapDto, ListDeviceConnectionsQueryDto, ListTopologyMapsQueryDto, UpdateDeviceConnectionDto, UpdateTopologyMapDto } from './dto';
import { TopologyService } from './topology.service';

@ApiTags('topology') @ApiBearerAuth() @Controller({ path: 'topology', version: '1' })
export class TopologyController {
  constructor(private readonly service: TopologyService) {}
  @Get('maps') maps(@Req() req: { user: AuthenticatedUser }, @Query() query: ListTopologyMapsQueryDto) { return this.service.list(req.user, query); }
  @Get('maps/:id') map(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.get(req.user, id); }
  @Post('maps') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') create(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateTopologyMapDto) { return this.service.create(req.user, dto); }
  @Patch('maps/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') update(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateTopologyMapDto) { return this.service.update(req.user, id, dto); }
  @Delete('maps/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') remove(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Query('revision') revision?: string) { return this.service.remove(req.user, id, revision === undefined ? undefined : Number(revision)); }
  @Put('maps/:id/nodes') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') nodes(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: BulkTopologyNodesDto) { return this.service.replaceNodes(req.user, id, dto); }
  @Post('maps/:id/connections') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') connection(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: CreateTopologyConnectionDto) { return this.service.createConnection(req.user, id, dto); }
  @Delete('maps/:id/connections/:connectionId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') deleteConnection(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Param('connectionId') connectionId: string, @Query('revision') revision?: string) { return this.service.removeConnection(req.user, id, connectionId, revision === undefined ? undefined : Number(revision)); }
  @Post('maps/:id/connections/:connectionId') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') associateConnection(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Param('connectionId') connectionId: string, @Body() dto: AssociateTopologyConnectionDto) { return this.service.associateConnection(req.user, id, connectionId, dto.revision); }
  @Get('connections') connections(@Req() req: { user: AuthenticatedUser }, @Query() query: ListDeviceConnectionsQueryDto) { return this.service.listConnections(req.user, query); }
  @Post('connections') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') createStandaloneConnection(@Req() req: { user: AuthenticatedUser }, @Body() dto: CreateDeviceConnectionDto) { return this.service.createStandaloneConnection(req.user, dto); }
  @Patch('connections/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') updateStandaloneConnection(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string, @Body() dto: UpdateDeviceConnectionDto) { return this.service.updateStandaloneConnection(req.user, id, dto); }
  @Delete('connections/:id') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR') deleteStandaloneConnection(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) { return this.service.deleteStandaloneConnection(req.user, id); }
}
