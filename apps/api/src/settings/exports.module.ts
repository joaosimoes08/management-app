import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { IpamModule } from '../ipam/ipam.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { AccessModule } from '../access/access.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({ imports: [DatabaseModule, AuditModule, IpamModule, InfrastructureModule, AccessModule], controllers: [ExportsController], providers: [ExportsService] })
export class ExportsModule {}
