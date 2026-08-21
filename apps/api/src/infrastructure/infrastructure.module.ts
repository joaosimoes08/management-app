import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureService } from './infrastructure.service';
@Module({ imports: [AuditModule], controllers: [InfrastructureController], providers: [InfrastructureService] })
export class InfrastructureModule {}
