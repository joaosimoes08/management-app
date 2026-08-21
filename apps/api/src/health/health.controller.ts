import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaClient } from '@simoes/database';
import { Public } from '../auth/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthCheckService, private readonly prismaHealth: PrismaHealthIndicator, private readonly prisma: PrismaClient) {}
  @Get()
  @Public()
  @SkipThrottle()
  @HealthCheck()
  check() { return this.health.check([() => this.prismaHealth.pingCheck('postgres', this.prisma)]); }
}
