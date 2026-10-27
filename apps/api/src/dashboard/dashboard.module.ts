import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { OperationsModule } from '../operations/operations.module';
import { InventoryQualityModule } from '../inventory-quality/inventory-quality.module';

@Module({ imports: [InfrastructureModule, IpamModule, OperationsModule, InventoryQualityModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
