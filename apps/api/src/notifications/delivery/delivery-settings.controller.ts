import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DeliveryTarget, NotificationDeliveryStatus, OperationalAlertSeverity } from '@simoes/database';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { AuthenticatedUser } from '../../auth/auth.service';
import { Roles } from '../../auth/roles.decorator';
import { GROUP_SEVERITIES } from './delivery-queue';
import { NotificationDeliveryService } from './notification-delivery.service';

class UpdateDeliveryChannelDto {
  @IsBoolean()
  enabled!: boolean;

  /** Write-only. Omit (or send empty) to keep the stored URL. */
  @IsOptional() @IsString() @MaxLength(2048)
  webhookUrl?: string;

  @IsOptional() @IsIn(GROUP_SEVERITIES)
  minSeverity?: OperationalAlertSeverity;
}

class ListDeliveriesQuery {
  @IsOptional() @IsEnum(NotificationDeliveryStatus)
  status?: NotificationDeliveryStatus;

  @IsOptional() @IsEnum(DeliveryTarget)
  target?: DeliveryTarget;

  @IsOptional() @IsUUID()
  cursor?: string;
}

type UserRequest = { user: AuthenticatedUser };

@ApiTags('settings') @ApiBearerAuth() @Controller({ path: 'settings', version: '1' })
export class DeliverySettingsController {
  constructor(private readonly deliveries: NotificationDeliveryService) {}

  @Get('notification-channels') @Roles('ADMIN')
  channels() { return this.deliveries.channels(); }

  @Put('notification-channels/:kind/:target') @Roles('ADMIN')
  update(@Param('kind') kind: string, @Param('target') target: string, @Body() body: UpdateDeliveryChannelDto, @Req() { user }: UserRequest) {
    return this.deliveries.updateChannel(kind, target, body, user);
  }

  @Delete('notification-channels/:kind/:target') @Roles('ADMIN')
  clear(@Param('kind') kind: string, @Param('target') target: string, @Req() { user }: UserRequest) {
    return this.deliveries.clearChannel(kind, target, user);
  }

  @Post('notification-channels/:kind/:target/test') @Roles('ADMIN')
  test(@Param('kind') kind: string, @Param('target') target: string, @Req() { user }: UserRequest) {
    return this.deliveries.sendTest(kind, target, user);
  }

  @Get('notification-deliveries') @Roles('ADMIN')
  list(@Query() query: ListDeliveriesQuery) { return this.deliveries.deliveries(query); }

  @Post('notification-deliveries/:id/retry') @Roles('ADMIN')
  retry(@Param('id', ParseUUIDPipe) id: string, @Req() { user }: UserRequest) { return this.deliveries.retry(id, user); }
}
