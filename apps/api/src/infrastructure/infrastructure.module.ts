import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureService } from './infrastructure.service';
import { InfrastructureAccessService } from './infrastructure-access.service';
import { IpamModule } from '../ipam/ipam.module';
@Module({ imports: [AuditModule, IpamModule], controllers: [InfrastructureController], providers: [InfrastructureService, InfrastructureAccessService], exports: [InfrastructureAccessService] })
export class InfrastructureModule {}
