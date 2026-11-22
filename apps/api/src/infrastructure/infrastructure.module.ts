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
import { DeviceRequiredConfigService } from './required-config/device-required-config.service';
import { DeviceRequiredConfigController } from './required-config/device-required-config.controller';
import { SiteCapacityController } from './capacity/site-capacity.controller';
import { SiteCapacityService } from './capacity/site-capacity.service';
import { RackCapacitySampler } from './capacity/rack-capacity-sampler.service';
import { RackUnitReservationsController } from './reservations/rack-unit-reservations.controller';
import { RackUnitReservationsService } from './reservations/rack-unit-reservations.service';
@Module({ imports: [AuditModule, IpamModule], controllers: [DeviceRequiredConfigController, InfrastructureController, LifecycleDatesController, PowerController, RackUnitReservationsController, SiteCapacityController], providers: [InfrastructureService, InfrastructureAccessService, LifecycleDatesService, RackPowerService, DeviceRequiredConfigService, SiteCapacityService, RackCapacitySampler, RackUnitReservationsService], exports: [InfrastructureAccessService, DeviceRequiredConfigService, LifecycleDatesService, SiteCapacityService] })
export class InfrastructureModule {}
