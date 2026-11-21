import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChangePlansModule } from '../change-plans/change-plans.module';
import { CriticalAssetsModule } from '../critical-assets/critical-assets.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { InventoryQualityModule } from '../inventory-quality/inventory-quality.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportGeneratorService } from './report-generator.service';
import { ReportSubscriptionsController, ScheduledReportsSettingsController } from './scheduled-reports.controller';
import { ScheduledReportsService } from './scheduled-reports.service';

@Module({
  imports: [AuditModule, NotificationsModule, InfrastructureModule, CriticalAssetsModule, InventoryQualityModule, ChangePlansModule],
  controllers: [ScheduledReportsSettingsController, ReportSubscriptionsController],
  providers: [ReportGeneratorService, ScheduledReportsService],
})
export class ReportsModule {}
