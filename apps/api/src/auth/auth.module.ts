import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { AuthService } from './auth.service';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';

@Module({ imports: [AuditModule], controllers: [AuthController], providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }] })
export class AuthModule {}
