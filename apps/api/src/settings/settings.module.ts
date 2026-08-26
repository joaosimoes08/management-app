import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { MaintenanceService } from './maintenance.service';
@Module({ imports: [AuditModule], controllers: [SettingsController], providers: [SettingsService, KeycloakAdminService, MaintenanceService] }) export class SettingsModule {}
