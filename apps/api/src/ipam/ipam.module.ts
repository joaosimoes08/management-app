import { Module } from '@nestjs/common';
import { IpamController } from './ipam.controller';
import { IpamService } from './ipam.service';
import { IpamAdvancedService } from './ipam-advanced.service';
import { AuditModule } from '../audit/audit.module';
import { IpamAccessService } from './ipam-access.service';

@Module({ imports: [AuditModule], controllers: [IpamController], providers: [IpamService, IpamAdvancedService, IpamAccessService] })
export class IpamModule {}
