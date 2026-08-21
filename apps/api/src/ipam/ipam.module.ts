import { Module } from '@nestjs/common';
import { IpamController } from './ipam.controller';
import { IpamService } from './ipam.service';
import { IpamAdvancedService } from './ipam-advanced.service';
import { AuditModule } from '../audit/audit.module';

@Module({ imports: [AuditModule], controllers: [IpamController], providers: [IpamService, IpamAdvancedService] })
export class IpamModule {}
