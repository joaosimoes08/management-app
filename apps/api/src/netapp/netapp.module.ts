import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { NetAppController } from './netapp.controller';
import { NetAppService } from './netapp.service';

@Module({ imports: [AuditModule, InfrastructureModule], controllers: [NetAppController], providers: [NetAppService] })
export class NetAppModule {}
