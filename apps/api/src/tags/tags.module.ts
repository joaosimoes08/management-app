import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { IpamModule } from '../ipam/ipam.module';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({ imports: [AuditModule, InfrastructureModule, IpamModule], controllers: [TagsController], providers: [TagsService] })
export class TagsModule {}
