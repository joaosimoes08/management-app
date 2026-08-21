import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApplicationLinksController } from './application-links.controller';
import { ApplicationLinksService } from './application-links.service';

@Module({ imports: [AuditModule], controllers: [ApplicationLinksController], providers: [ApplicationLinksService] })
export class ApplicationLinksModule {}
