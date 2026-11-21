import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { TopologyController } from './topology.controller';
import { TopologyImpactService } from './topology-impact.service';
import { TopologyService } from './topology.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [TopologyController], providers: [TopologyService, TopologyImpactService] })
export class TopologyModule {}
