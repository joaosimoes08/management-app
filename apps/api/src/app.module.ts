import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ApplicationLinksModule } from './application-links/application-links.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SetupModule } from './setup/setup.module';
import { IpamModule } from './ipam/ipam.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { SettingsModule } from './settings/settings.module';
import { SnmpModule } from './snmp/snmp.module';
import { AccessModule } from './access/access.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    AccessModule,
    AuditModule,
    HealthModule,
    ApplicationLinksModule,
    DashboardModule,
    SetupModule,
    IpamModule,
    InfrastructureModule,
    SettingsModule,
    SnmpModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
