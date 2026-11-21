import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeliverySettingsController } from './delivery/delivery-settings.controller';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';
import { NotificationsController } from './notifications.controller';

@Module({ imports: [AuditModule], controllers: [NotificationsController, DeliverySettingsController], providers: [NotificationDeliveryService], exports: [NotificationDeliveryService] })
export class NotificationsModule {}
