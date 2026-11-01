import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { LinuxAgentController } from './linux-agent.controller';
import { LinuxAgentService } from './linux-agent.service';

@Module({ imports: [AuditModule, InfrastructureModule], controllers: [LinuxAgentController], providers: [LinuxAgentService] })
export class LinuxAgentModule {}
