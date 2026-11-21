import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { LinuxAgentController } from './linux-agent.controller';
import { LinuxAgentService } from './linux-agent.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [LinuxAgentController], providers: [LinuxAgentService] })
export class LinuxAgentModule {}
