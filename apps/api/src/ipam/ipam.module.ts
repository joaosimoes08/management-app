import { forwardRef, Module } from '@nestjs/common';
import { IpamController } from './ipam.controller';
import { IpamService } from './ipam.service';
import { IpamAdvancedService } from './ipam-advanced.service';
import { AuditModule } from '../audit/audit.module';
import { IpamAccessService } from './ipam-access.service';
import { IpReservationService } from './ip-reservation.service';
import { SubnetCapacityService } from './subnet-capacity.service';
import { IpamWorkflowsService } from './ipam-workflows.service';
import { IpDriftService } from './ip-drift.service';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { DiscoveryIdentityService } from '../discovery/discovery-identity.service';

@Module({ imports: [AuditModule, forwardRef(() => InfrastructureModule)], controllers: [IpamController], providers: [IpamService, IpamAdvancedService, IpamAccessService, IpReservationService, SubnetCapacityService, IpamWorkflowsService, IpDriftService, DiscoveryIdentityService], exports: [IpamAccessService] })
export class IpamModule {}
