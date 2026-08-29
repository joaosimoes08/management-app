import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { MaintenanceService } from './maintenance.service';
import { RoleRequestService } from './role-request.service';
import { AccessGroupService } from './access-group.service';
@Module({ imports: [AuditModule], controllers: [SettingsController], providers: [SettingsService, KeycloakAdminService, MaintenanceService, RoleRequestService, AccessGroupService] }) export class SettingsModule {}
