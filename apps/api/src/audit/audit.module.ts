import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import { AuditController } from './audit.controller';
@Module({ controllers: [AuditController], providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }], exports: [AuditService] })
export class AuditModule {}
