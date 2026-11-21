import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, PrismaClient } from '@simoes/database';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../auth/auth.service';
import { channelsAvailableForUsers } from './delivery/delivery-queue';
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
  /** In-app delivery (Step 27). A muted topic gets no notification on any channel. */
  @IsOptional() @IsBoolean()
  muted?: boolean;

  /** Also post this topic to Microsoft Teams (Step 31). Needs the ADMIN Teams channel to be enabled. */
  @IsOptional() @IsBoolean()
  teams?: boolean;

  /** Also e-mail this topic to the user's own address (Step 31). Needs the ADMIN e-mail channel to be enabled. */
  @IsOptional() @IsBoolean()
  email?: boolean;
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
    const [mutes, channels, available, me] = await Promise.all([
      this.prisma.notificationMute.findMany({ where: { userId: user.id }, select: { type: true } }),
      this.prisma.notificationChannelPreference.findMany({ where: { userId: user.id }, select: { type: true, channel: true } }),
      channelsAvailableForUsers(this.prisma),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } }),
    ]);
    const muted = new Set(mutes.map(({ type }) => type));
    const has = (channel: string, type: string) => channels.some((row) => row.channel === channel && row.type === type);
    const hasEmail = Boolean(me?.email?.trim());
    return Object.values(NotificationTopic).map((type) => ({
      type, muted: muted.has(type), teams: has('TEAMS', type), teamsAvailable: available.teams,
      email: has('EMAIL', type), emailAvailable: available.email, hasEmail,
    }));
  }

  /** Which external channels an ADMIN has turned on, so Perfil can show or disable the per-topic toggles. */
  @Get('channels')
  async channels() {
    const available = await channelsAvailableForUsers(this.prisma);
    return { teams: { available: available.teams }, email: { available: available.email } };
  }

  @Patch('preferences/:type')
  async setPreference(@Req() { user }: UserRequest, @Param('type', new ParseEnumPipe(NotificationTopic)) type: NotificationTopic, @Body() dto: UpdateNotificationPreferenceDto) {
    if (dto.muted === undefined && dto.teams === undefined && dto.email === undefined) throw new BadRequestException({ code: 'NOTIFICATION_PREFERENCE_EMPTY', message: 'Indica muted, teams e/ou email.' });
    const available = await channelsAvailableForUsers(this.prisma);
    if (dto.teams === true && !available.teams) {
      throw new ConflictException({ code: 'NOTIFICATION_CHANNEL_UNAVAILABLE', message: 'O canal Microsoft Teams não está ativo. Pede a um ADMIN para o configurar em Definições.' });
    }
    if (dto.email === true) {
      if (!available.email) throw new ConflictException({ code: 'NOTIFICATION_CHANNEL_UNAVAILABLE', message: 'O envio por email não está ativo. Pede a um ADMIN para o configurar em Definições.' });
      const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
      if (!me?.email?.trim()) throw new ConflictException({ code: 'NOTIFICATION_EMAIL_MISSING', message: 'O teu utilizador não tem email definido.' });
    }
    if (dto.muted === true) await this.prisma.notificationMute.createMany({ data: [{ userId: user.id, type }], skipDuplicates: true });
    else if (dto.muted === false) await this.prisma.notificationMute.deleteMany({ where: { userId: user.id, type } });
    for (const [channel, value] of [['TEAMS', dto.teams], ['EMAIL', dto.email]] as const) {
      if (value === true) await this.prisma.notificationChannelPreference.createMany({ data: [{ userId: user.id, type, channel }], skipDuplicates: true });
      else if (value === false) await this.prisma.notificationChannelPreference.deleteMany({ where: { userId: user.id, type, channel } });
    }
    const [muted, channels, me] = await Promise.all([
      this.prisma.notificationMute.findUnique({ where: { userId_type: { userId: user.id, type } }, select: { type: true } }),
      this.prisma.notificationChannelPreference.findMany({ where: { userId: user.id, type }, select: { channel: true } }),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } }),
    ]);
    return {
      type, muted: Boolean(muted), teams: channels.some((row) => row.channel === 'TEAMS'), teamsAvailable: available.teams,
      email: channels.some((row) => row.channel === 'EMAIL'), emailAvailable: available.email, hasEmail: Boolean(me?.email?.trim()),
    };
  }
}
