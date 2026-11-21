import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { SnmpController } from './snmp.controller';
import { SnmpService } from './snmp.service';
import { TopologyReconciliationService } from './topology-reconciliation.service';
import { SnmpFleetService } from './snmp-fleet.service';

@Module({ imports: [AuditModule, InfrastructureModule], controllers: [SnmpController], providers: [SnmpService, TopologyReconciliationService, SnmpFleetService] })
export class SnmpModule {}
