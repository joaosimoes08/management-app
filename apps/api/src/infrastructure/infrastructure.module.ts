import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureService } from './infrastructure.service';
import { InfrastructureAccessService } from './infrastructure-access.service';
import { LifecycleDatesController } from './lifecycle-dates.controller';
import { LifecycleDatesService } from './lifecycle-dates.service';
import { IpamModule } from '../ipam/ipam.module';
import { PowerController } from './power/power.controller';
import { RackPowerService } from './power/rack-power.service';
@Module({ imports: [AuditModule, IpamModule], controllers: [InfrastructureController, LifecycleDatesController, PowerController], providers: [InfrastructureService, InfrastructureAccessService, LifecycleDatesService, RackPowerService], exports: [InfrastructureAccessService] })
export class InfrastructureModule {}
