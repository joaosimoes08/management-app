import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { UserThrottlerGuard } from './user-throttler.guard';
import { AuthService } from './auth.service';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    // Global guards run in this order: verify the token, then rate-limit per verified user, then check roles.
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AuthModule {}
