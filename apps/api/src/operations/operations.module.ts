import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsReconcilerService } from './operations-reconciler.service';
import { AlertConfigurationController } from './alert-configuration.controller';
import { AlertConfigurationService } from './alert-configuration.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [OperationsController, AlertConfigurationController], providers: [OperationsService, OperationsReconcilerService, AlertConfigurationService], exports: [OperationsService] })
export class OperationsModule {}
