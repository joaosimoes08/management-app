import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { DiscoveryTopologyLinkService } from './discovery-topology-link.service';
import { SnmpController } from './snmp.controller';
import { SnmpService } from './snmp.service';
import { TopologyReconciliationService } from './topology-reconciliation.service';
import { SnmpFleetService } from './snmp-fleet.service';
import { SnmpHealthThresholdsService } from './snmp-health-thresholds.service';
import { SnmpEndpointsService } from './snmp-endpoints.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [SnmpController], providers: [SnmpService, TopologyReconciliationService, SnmpFleetService, SnmpHealthThresholdsService, DiscoveryTopologyLinkService, SnmpEndpointsService] })
export class SnmpModule {}
