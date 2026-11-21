import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { AuthenticatedUser } from '../auth/auth.service';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { REPORT_SECTIONS } from './report-content';
import { MAX_RECIPIENTS, ScheduledReportsService } from './scheduled-reports.service';

class ScheduledReportDto {
  @IsString() @MaxLength(120)
  name!: string;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsIn(['WEEKLY', 'MONTHLY'])
  frequency!: 'WEEKLY' | 'MONTHLY';

  /** WEEKLY: 1 (Monday) to 7 (Sunday). */
  @IsOptional() @IsInt() @Min(1) @Max(7)
  dayOfWeek?: number | null;

  /** MONTHLY: 1 to 28, so every month has the day. */
  @IsOptional() @IsInt() @Min(1) @Max(28)
  dayOfMonth?: number | null;

  @IsInt() @Min(0) @Max(23)
  hour!: number;

  @IsString() @MaxLength(64)
  timezone!: string;

  @IsArray() @ArrayMaxSize(REPORT_SECTIONS.length) @IsIn(REPORT_SECTIONS, { each: true })
  sections!: string[];

  /** Empty: every Site each recipient may read. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  siteIds?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_RECIPIENTS) @IsUUID('all', { each: true })
  recipientIds?: string[];

  @IsOptional() @IsBoolean()
  sendEmail?: boolean;

  @IsOptional() @IsBoolean()
  sendTeams?: boolean;
}

class SubscriptionDto {
  @IsBoolean()
  subscribed!: boolean;
}

class UnsubscribeDto {
  @IsString() @MaxLength(128)
  token!: string;
}

type Reply = { type: (value: string) => void; header: (name: string, value: string) => void };
function sendCsv(reply: Reply, file: { filename: string; body: string }) {
  reply.type('text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
  return file.body;
}

/** Report definitions (Definições → Relatórios): ADMIN only. */
@ApiTags('settings') @ApiBearerAuth() @Controller({ path: 'settings/scheduled-reports', version: '1' })
export class ScheduledReportsSettingsController {
  constructor(private readonly service: ScheduledReportsService) {}

  @Get() @Roles('ADMIN')
  list() { return this.service.list(); }

  @Post() @Roles('ADMIN')
  create(@Body() body: ScheduledReportDto, @Req() req: { user: AuthenticatedUser }) { return this.service.create(body, req.user); }

  @Put(':id') @Roles('ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: ScheduledReportDto, @Req() req: { user: AuthenticatedUser }) { return this.service.update(id, body, req.user); }

  @Delete(':id') @Roles('ADMIN')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.remove(id, req.user); }

  /** Sends the report now to every subscribed recipient (each with their own Sites). */
  @Post(':id/run') @Roles('ADMIN') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  run(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.run(id, 'MANUAL', req.user); }

  /** The report as the signed-in ADMIN would get it. */
  @Get(':id/preview') @Roles('ADMIN')
  preview(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }) { return this.service.documentFor(id, req.user); }

  @Get(':id/csv') @Roles('ADMIN')
  async csv(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: AuthenticatedUser }, @Res({ passthrough: true }) reply: Reply) {
    return sendCsv(reply, await this.service.csvFor(id, req.user));
  }
}

/** A recipient's own reports: subscribe/unsubscribe and download, always with only the Sites they may read. */
@ApiTags('reports') @ApiBearerAuth() @Controller({ path: 'reports', version: '1' })
export class ReportSubscriptionsController {
  constructor(private readonly service: ScheduledReportsService) {}

  @Get('subscriptions')
  list(@Req() req: { user: AuthenticatedUser }) { return this.service.mySubscriptions(req.user); }

  @Patch('subscriptions/:reportId')
  set(@Param('reportId', ParseUUIDPipe) reportId: string, @Body() body: SubscriptionDto, @Req() req: { user: AuthenticatedUser }) { return this.service.setSubscribed(reportId, body.subscribed, req.user); }

  @Get('subscriptions/:reportId/preview')
  async preview(@Param('reportId', ParseUUIDPipe) reportId: string, @Req() req: { user: AuthenticatedUser }) {
    await this.service.assertRecipient(reportId, req.user);
    return this.service.documentFor(reportId, req.user);
  }

  @Get('subscriptions/:reportId/csv')
  async csv(@Param('reportId', ParseUUIDPipe) reportId: string, @Req() req: { user: AuthenticatedUser }, @Res({ passthrough: true }) reply: Reply) {
    await this.service.assertRecipient(reportId, req.user);
    return sendCsv(reply, await this.service.csvFor(reportId, req.user));
  }

  /** The e-mail's unsubscribe link: GET only reads (mail scanners follow links), POST unsubscribes. */
  @Public() @Get('unsubscribe') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  status(@Query('token') token: string) { return this.service.unsubscribeStatus(token); }

  @Public() @Post('unsubscribe') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unsubscribe(@Body() body: UnsubscribeDto) { return this.service.unsubscribe(body.token); }
}
