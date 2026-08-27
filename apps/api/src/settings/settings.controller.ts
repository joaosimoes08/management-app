import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { UpdateAuditPolicyDto, UpdateDiscoveryDefaultsDto, UpdateOrganizationSettingsDto, UpdateUserRolesDto } from './dto';
import { KeycloakAdminService } from './keycloak-admin.service';
import { SettingsService } from './settings.service';
import { CreateRoleRequestDto, DecideRoleRequestDto } from './role-request.dto';
import { RoleRequestService } from './role-request.service';

@ApiTags('settings') @ApiBearerAuth() @Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly service: SettingsService, private readonly keycloak: KeycloakAdminService, private readonly roleRequests: RoleRequestService) {}
  @Get('organization') organization() { return this.service.organization(); }
  @Patch('organization') @Roles('ADMIN') updateOrganization(@Body() body: UpdateOrganizationSettingsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateOrganization(body, req.user); }
  @Get('discovery') discovery() { return this.service.discovery(); }
  @Patch('discovery') @Roles('ADMIN') updateDiscovery(@Body() body: UpdateDiscoveryDefaultsDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateDiscovery(body, req.user); }
  @Get('audit-policy') @Roles('ADMIN', 'AUDITOR') auditPolicy() { return this.service.auditPolicy(); }
  @Patch('audit-policy') @Roles('ADMIN') updateAuditPolicy(@Body() body: UpdateAuditPolicyDto, @Req() req: { user: AuthenticatedUser }) { return this.service.updateAuditPolicy(body, req.user); }
  @Get('users') @Roles('ADMIN') users(@Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { return this.service.users(search, page, pageSize); }
  @Patch('users/:externalId/roles') @Roles('ADMIN') updateUserRoles(@Param('externalId') externalId: string, @Body() body: UpdateUserRolesDto, @Req() req: { user: AuthenticatedUser }) { return this.keycloak.updateRoles(externalId, body.roles, req.user); }
  @Get('role-requests/me') mineRoleRequests(@Req() req: { user: AuthenticatedUser }) { return this.roleRequests.mine(req.user); }
  @Post('role-requests') submitRoleRequest(@Body() body: CreateRoleRequestDto, @Req() req: { user: AuthenticatedUser }) { return this.roleRequests.submit(req.user, body.roles); }
  @Patch('role-requests/:id') @Roles('ADMIN') decideRoleRequest(@Param('id') id: string, @Body() body: DecideRoleRequestDto, @Req() req: { user: AuthenticatedUser }) { return this.roleRequests.decide(id, body.decision, req.user); }
  @Get('integrations') integrations() { return this.service.integrations(); }
  @Get('system') system() { return this.service.system(); }
}
