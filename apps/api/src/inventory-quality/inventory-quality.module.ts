import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { OperationsModule } from '../operations/operations.module';
import { IpamModule } from '../ipam/ipam.module';
import { InventoryQualityController } from './inventory-quality.controller';
import { InventoryQualityService } from './inventory-quality.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule, OperationsModule], controllers: [InventoryQualityController], providers: [InventoryQualityService], exports: [InventoryQualityService] })
export class InventoryQualityModule {}
