import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [TopologyController], providers: [TopologyService] })
export class TopologyModule {}
