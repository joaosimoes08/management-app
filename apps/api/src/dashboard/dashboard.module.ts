import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [InfrastructureModule, IpamModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
