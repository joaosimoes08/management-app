import { Body, Controller, Get, NotFoundException, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, PrismaClient } from '@simoes/database';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../auth/auth.service';
import { NotificationTopic, notificationHref } from './notification-preferences';

enum NotificationStatus { UNREAD = 'unread', ALL = 'all' }

class ListNotificationsQuery {
  @IsOptional() @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional() @IsEnum(NotificationTopic)
  type?: NotificationTopic;

  @IsOptional() @IsUUID()
  cursor?: string;
}

class UpdateReadStatusDto {
  @IsBoolean()
  read!: boolean;
}

class UpdateNotificationPreferenceDto {
  @IsBoolean()
  muted!: boolean;
}

const PAGE_SIZE = 25;
type UserRequest = { user: AuthenticatedUser };

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly prisma: PrismaClient) {}

  @Get()
  async list(@Req() { user }: UserRequest, @Query() query: ListNotificationsQuery) {
    const cursor = query.cursor ? await this.prisma.notification.findFirst({
      where: { userId: user.id, id: query.cursor },
      select: { id: true, createdAt: true },
    }) : null;
    if (query.cursor && !cursor) throw new NotFoundException('Notificação não encontrada.');
    const where: Prisma.NotificationWhereInput = { userId: user.id };
    if (query.status === NotificationStatus.UNREAD) where.readAt = null;
    if (query.type === NotificationTopic.ROLE_REQUEST) where.type = { startsWith: 'ROLE_REQUEST_' };
    else if (query.type) where.type = query.type;
    if (cursor) where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }];
    const rows = await this.prisma.notification.findMany({
      where, take: PAGE_SIZE + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, type: true, roleRequestId: true, title: true, message: true, createdAt: true, readAt: true, sourceHref: true },
    });
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE).map((notification) => ({
      id: notification.id, type: notification.type, title: notification.title, message: notification.message,
      createdAt: notification.createdAt, readAt: notification.readAt, href: notificationHref(notification),
    }));
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }

  @Patch(':id/read')
  async read(@Req() { user }: UserRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReadStatusDto) {
    const where = { userId: user.id, id };
    const updated = await this.prisma.notification.updateMany({
      where: { ...where, readAt: dto.read ? null : { not: null } },
      data: { readAt: dto.read ? new Date() : null },
    });
    if (!updated.count && !(await this.prisma.notification.findFirst({ where, select: { id: true } }))) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    return { id, read: dto.read };
  }

  @Get('preferences')
  async preferences(@Req() { user }: UserRequest) {
    const muted = new Set((await this.prisma.notificationMute.findMany({ where: { userId: user.id }, select: { type: true } })).map(({ type }) => type));
    return Object.values(NotificationTopic).map((type) => ({ type, muted: muted.has(type) }));
  }

  @Patch('preferences/:type')
  async setPreference(@Req() { user }: UserRequest, @Param('type', new ParseEnumPipe(NotificationTopic)) type: NotificationTopic, @Body() dto: UpdateNotificationPreferenceDto) {
    if (dto.muted) {
      await this.prisma.notificationMute.createMany({ data: [{ userId: user.id, type }], skipDuplicates: true });
    } else {
      await this.prisma.notificationMute.deleteMany({ where: { userId: user.id, type } });
    }
    return { type, muted: dto.muted };
  }
}
