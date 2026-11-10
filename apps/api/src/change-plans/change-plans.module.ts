import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { ChangePlansController } from './change-plans.controller';
import { ChangePlansService } from './change-plans.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [ChangePlansController], providers: [ChangePlansService] })
export class ChangePlansModule {}
