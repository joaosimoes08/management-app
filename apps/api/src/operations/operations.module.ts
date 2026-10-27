import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsReconcilerService } from './operations-reconciler.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [OperationsController], providers: [OperationsService, OperationsReconcilerService], exports: [OperationsService] })
export class OperationsModule {}
