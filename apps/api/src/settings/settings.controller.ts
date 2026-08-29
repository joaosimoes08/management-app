import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AccessGroupMemberDto, CreateAccessGroupDto, UpdateAccessGroupDto, UpdateAccessGroupSiteDto, UpdateAuditPolicyDto, UpdateDiscoveryDefaultsDto, UpdateOrganizationSettingsDto, UpdateUserRolesDto } from './dto';
import { KeycloakAdminService } from './keycloak-admin.service';
import { SettingsService } from './settings.service';
import { CreateRoleRequestDto, DecideRoleRequestDto } from './role-request.dto';
import { RoleRequestService } from './role-request.service';
import { AccessGroupService } from './access-group.service';

@ApiTags('settings') @ApiBearerAuth() @Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly service: SettingsService, private readonly keycloak: KeycloakAdminService, private readonly roleRequests: RoleRequestService, private readonly accessGroups: AccessGroupService) {}
  @Get('organization') organization(@Req() req: { user: AuthenticatedUser }) { return this.service.organization(req.user); }
  @Patch('organization') @Roles('ADMIN') updateOrganization(@Body() body: UpdateOrganizationSettingsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateOrganization(body, req.user); }
  @Get('discovery') discovery() { return this.service.discovery(); }
  @Patch('discovery') @Roles('ADMIN') updateDiscovery(@Body() body: UpdateDiscoveryDefaultsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateDiscovery(body, req.user); }
  @Get('audit-policy') @Roles('ADMIN', 'AUDITOR') auditPolicy() { return this.service.auditPolicy(); }
  @Patch('audit-policy') @Roles('ADMIN') updateAuditPolicy(@Body() body: UpdateAuditPolicyDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateAuditPolicy(body, req.user); }
  @Get('users') @Roles('ADMIN') users(@Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.users(search, page, pageSize); }
  @Get('legacy-role-assignments') @Roles('ADMIN') legacyRoleAssignments() { return this.service.legacyRoleAssignments(); }
  @Patch('users/:externalId/roles') @Roles('ADMIN') updateUserRoles(@Param('externalId') externalId: string, @Body() body: UpdateUserRolesDto, @Req() req: { user: AuthenticatedUser }) { return this.keycloak.updateRoles(externalId, body.roles, req.user); }
  @Get('role-requests/me') mineRoleRequests(@Req() req: { user: AuthenticatedUser }) { return this.roleRequests.mine(req.user); }
  @Post('role-requests') submitRoleRequest(@Body() body: CreateRoleRequestDto, @Req() req: { user: AuthenticatedUser }) { return this.roleRequests.submit(req.user, body.roles); }
  @Patch('role-requests/:id') @Roles('ADMIN') decideRoleRequest(@Param('id') id: string, @Body() body: DecideRoleRequestDto, @Req() req: { user: AuthenticatedUser }) { return this.roleRequests.decide(id, body.decision, req.user); }
  @Get('access-groups') @Roles('ADMIN') groups(@Query('siteId') siteId?: string) { return this.accessGroups.list(siteId); }
  @Post('access-groups') @Roles('ADMIN') createGroup(@Body() body: CreateAccessGroupDto, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.create(body, req.user); }
  @Patch('access-groups/:id') @Roles('ADMIN') updateGroup(@Param('id') id: string, @Body() body: UpdateAccessGroupDto, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.update(id, body, req.user); }
  @Delete('access-groups/:id') @Roles('ADMIN') deleteGroup(@Param('id') id: string, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.remove(id, req.user); }
  @Get('access-group-users') @Roles('ADMIN') groupUsers(@Query('search') search?: string) { return this.accessGroups.users(search); }
  @Post('access-groups/:id/members') @Roles('ADMIN') addGroupMember(@Param('id') id: string, @Body() body: AccessGroupMemberDto, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.addMember(id, body.userId, req.user); }
  @Delete('access-groups/:id/members/:userId') @Roles('ADMIN') removeGroupMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.removeMember(id, userId, req.user); }
  @Put('access-groups/:id/sites/:siteId') @Roles('ADMIN') assignGroupSite(@Param('id') id: string, @Param('siteId') siteId: string, @Body() body: UpdateAccessGroupSiteDto, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.assignSite(id, siteId, body.permissions, req.user); }
  @Delete('access-groups/:id/sites/:siteId') @Roles('ADMIN') removeGroupSite(@Param('id') id: string, @Param('siteId') siteId: string, @Req() req: { user: AuthenticatedUser }) { return this.accessGroups.removeSite(id, siteId, req.user); }
  @Get('integrations') integrations() { return this.service.integrations(); }
  @Get('system') system() { return this.service.system(); }
}
