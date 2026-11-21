import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DeliveryChannelKind, DeliveryTarget, NotificationDeliveryStatus, OperationalAlertSeverity, Prisma, PrismaClient } from '@simoes/database';
import { decryptCredential, encryptCredential, loadKeyring } from '@simoes/snmp-core';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.service';
import { DeliveryChannelSender, DeliveryError } from './channel';
import { AlertForDelivery, DEFAULT_GROUP_MIN_SEVERITY, GROUP_SEVERITIES, queueAlertDelivery, TEST_TOPIC } from './delivery-queue';
import { TeamsSender } from './teams-sender';

export const DELIVERY_SENDERS = Symbol('DELIVERY_SENDERS');

export const MAX_ATTEMPTS = 5;
/** Wait after attempt N fails (index N-1). Attempt 5 is the last. */
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
/** Poll interval: well under a minute so a queued CRITICAL alert is posted within 1 min even if the immediate kick is missed. */
export const DEFAULT_POLL_MS = 15_000;
const STALE_SENDING_MS = 120_000;
const BATCH = 25;
const RETENTION_DAYS = 90;
const PAGE_SIZE = 50;

export type ChannelSettingsInput = { enabled: boolean; webhookUrl?: string; minSeverity?: OperationalAlertSeverity };

const deliverySelect = {
  id: true, channel: true, target: true, status: true, topic: true, title: true, attempts: true, failureReason: true,
  nextAttemptAt: true, lastAttemptAt: true, sentAt: true, createdAt: true, alertId: true,
  recipient: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.NotificationDeliverySelect;

export function pollIntervalMs(value = process.env.NOTIFICATION_DELIVERY_POLL_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 30_000 ? parsed : DEFAULT_POLL_MS;
}

export function publicLink(href: string | null, base = process.env.APP_PUBLIC_URL) {
  if (!href || !base || !href.startsWith('/') || href.startsWith('//')) return null;
  try {
    const origin = new URL(base);
    return origin.protocol === 'https:' || origin.protocol === 'http:' ? new URL(href, origin).toString() : null;
  } catch { return null; }
}

/** Next state after a failed attempt (attempts already includes this attempt). */
export function failureOutcome(attempts: number, retryable: boolean, now: Date) {
  if (!retryable || attempts >= MAX_ATTEMPTS) return { status: 'FAILED' as const, nextAttemptAt: now };
  return { status: 'PENDING' as const, nextAttemptAt: new Date(now.getTime() + RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length) - 1]) };
}

@Injectable()
export class NotificationDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private readonly senders: Map<DeliveryChannelKind, DeliveryChannelSender>;
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  private again = false;
  private lastPrune = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    @Optional() @Inject(DELIVERY_SENDERS) senders?: DeliveryChannelSender[],
  ) {
    this.senders = new Map((senders ?? [new TeamsSender()]).map((sender) => [sender.kind as DeliveryChannelKind, sender]));
  }

  onModuleInit() {
    if (process.env.NOTIFICATION_DELIVERY_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.kick(), pollIntervalMs());
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** Starts a drain now (or right after the current one). Never throws; callers do not await it on a request path. */
  kick(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do {
        this.again = false;
        try { await this.drain(); } catch (error) { this.logger.error(`Delivery drain failed: ${error instanceof Error ? error.name : 'unknown'}`); }
      } while (this.again);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** Queues a group-channel post for an alert that just opened or reopened and kicks the dispatcher. Never throws. */
  async alertOpened(alert: AlertForDelivery, occurrence: Date) {
    try {
      if (await queueAlertDelivery(this.prisma, alert, occurrence)) void this.kick();
    } catch (error) {
      this.logger.warn(`Could not queue alert ${alert.id} for the group channel: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  async drain(now = () => new Date()) {
    await this.prisma.notificationDelivery.updateMany({
      where: { status: 'SENDING', lastAttemptAt: { lt: new Date(now().getTime() - STALE_SENDING_MS) } },
      data: { status: 'PENDING', nextAttemptAt: now() },
    });
    const destinations = new Map<string, string | DeliveryError>();
    for (let round = 0; round < 20; round++) {
      const due = await this.prisma.notificationDelivery.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now() } }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: BATCH,
        select: { id: true },
      });
      if (!due.length) break;
      for (const { id } of due) await this.attempt(id, destinations, now);
    }
    if (Date.now() - this.lastPrune > 3_600_000) {
      this.lastPrune = Date.now();
      await this.prisma.notificationDelivery.deleteMany({ where: { status: { in: ['SENT', 'FAILED'] }, createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } });
    }
  }

  private async destination(kind: DeliveryChannelKind, target: DeliveryTarget, requireEnabled: boolean): Promise<string> {
    const config = await this.prisma.deliveryChannelConfig.findUnique({ where: { kind_target: { kind, target } } });
    if (!config?.keyId || !config.ciphertext || !config.iv || !config.authTag || !config.wrappedDek || !config.wrapIv || !config.wrapAuthTag) throw new DeliveryError('CHANNEL_NOT_CONFIGURED', false);
    if (requireEnabled && !config.enabled) throw new DeliveryError('CHANNEL_DISABLED', false);
    let keyring;
    try { keyring = loadKeyring(); } catch { throw new DeliveryError('KEYRING_UNAVAILABLE', true); }
    try {
      const url = decryptCredential(config as never, keyring).webhookUrl;
      if (!url) throw new Error('missing');
      return url;
    } catch { throw new DeliveryError('SECRET_UNREADABLE', false); }
  }

  private async attempt(id: string, cache: Map<string, string | DeliveryError>, now: () => Date) {
    const startedAt = now();
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: startedAt } },
      data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: startedAt },
    });
    if (!claimed.count) return;
    const row = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id }, include: { recipient: { select: { username: true, displayName: true } } },
    });
    try {
      const sender = this.senders.get(row.channel);
      if (!sender) throw new DeliveryError('CHANNEL_UNSUPPORTED', false);
      const cacheKey = `${row.channel}:${row.target}`;
      if (!cache.has(cacheKey)) {
        try { cache.set(cacheKey, await this.destination(row.channel, row.target, row.topic !== TEST_TOPIC)); }
        catch (error) { cache.set(cacheKey, error instanceof DeliveryError ? error : new DeliveryError('CHANNEL_ERROR', true)); }
      }
      const destination = cache.get(cacheKey)!;
      if (destination instanceof DeliveryError) throw destination;
      await sender.send(destination, this.message(row));
      await this.prisma.notificationDelivery.update({ where: { id }, data: { status: 'SENT', sentAt: now(), failureReason: null } });
    } catch (error) {
      const failure = error instanceof DeliveryError ? error : new DeliveryError('UNEXPECTED_ERROR', true);
      const outcome = failureOutcome(row.attempts, failure.retryable, now());
      await this.prisma.notificationDelivery.update({ where: { id }, data: { ...outcome, failureReason: failure.code } });
      this.logger.warn(`Delivery ${id} attempt ${row.attempts} failed: ${failure.code}${outcome.status === 'PENDING' ? '; retry scheduled' : ''}`);
    }
  }

  private message(row: { title: string; message: string; href: string | null; target: DeliveryTarget; recipient: { username: string; displayName: string | null } | null }) {
    const severity = row.target === 'GROUP_ALERTS' ? /^\[(CRITICAL|HIGH|WARNING|INFO)\]/.exec(row.title)?.[1] ?? null : null;
    return {
      title: row.title, message: row.message, url: publicLink(row.href), severity,
      recipientLabel: row.recipient ? (row.recipient.displayName ? `${row.recipient.displayName} (${row.recipient.username})` : row.recipient.username) : null,
    };
  }

  // ----- ADMIN settings -----

  private parseTarget(kind: string, target: string) {
    if (kind !== 'TEAMS') throw new NotFoundException({ code: 'NOTIFICATION_CHANNEL_UNKNOWN', message: 'Canal de entrega desconhecido.' });
    if (target !== 'USER_NOTIFICATIONS' && target !== 'GROUP_ALERTS') throw new NotFoundException({ code: 'NOTIFICATION_CHANNEL_UNKNOWN', message: 'Destino de entrega desconhecido.' });
    return { kind: kind as DeliveryChannelKind, target: target as DeliveryTarget };
  }

  private present(target: DeliveryTarget, config: { enabled: boolean; keyId: string | null; minSeverity: OperationalAlertSeverity | null; updatedAt: Date } | null) {
    return {
      kind: 'TEAMS' as const, target, enabled: Boolean(config?.enabled), configured: Boolean(config?.keyId),
      minSeverity: target === 'GROUP_ALERTS' ? config?.minSeverity ?? DEFAULT_GROUP_MIN_SEVERITY : null,
      updatedAt: config?.updatedAt ?? null,
    };
  }

  async channels() {
    const rows = await this.prisma.deliveryChannelConfig.findMany({ where: { kind: 'TEAMS' }, select: { target: true, enabled: true, keyId: true, minSeverity: true, updatedAt: true } });
    let keyringAvailable = true;
    try { loadKeyring(); } catch { keyringAvailable = false; }
    const targets: DeliveryTarget[] = ['USER_NOTIFICATIONS', 'GROUP_ALERTS'];
    return {
      channels: targets.map((target) => this.present(target, rows.find((row) => row.target === target) ?? null)),
      keyringAvailable, publicLinks: Boolean(publicLink('/', process.env.APP_PUBLIC_URL)), maxAttempts: MAX_ATTEMPTS,
    };
  }

  async updateChannel(kindValue: string, targetValue: string, input: ChannelSettingsInput, user: AuthenticatedUser) {
    const { kind, target } = this.parseTarget(kindValue, targetValue);
    const sender = this.senders.get(kind)!;
    if (input.minSeverity !== undefined && (target !== 'GROUP_ALERTS' || !(GROUP_SEVERITIES as readonly string[]).includes(input.minSeverity))) {
      throw new BadRequestException({ code: 'NOTIFICATION_CHANNEL_SEVERITY_INVALID', message: 'A severidade mínima só se aplica ao canal de grupo e tem de ser CRITICAL ou HIGH.' });
    }
    let envelope: ReturnType<typeof encryptCredential> | undefined;
    if (input.webhookUrl !== undefined && input.webhookUrl.trim() !== '') {
      let url: string;
      try { url = sender.validateDestination(input.webhookUrl); }
      catch { throw new BadRequestException({ code: 'TEAMS_WEBHOOK_INVALID', message: 'Indica o URL HTTPS de um webhook do Microsoft Teams (webhook.office.com ou Workflows).' }); }
      try { envelope = encryptCredential({ webhookUrl: url }, loadKeyring()); }
      catch { throw new ConflictException({ code: 'NOTIFICATION_KEYRING_UNAVAILABLE', message: 'O cofre de credenciais não está configurado.' }); }
    }
    const existing = await this.prisma.deliveryChannelConfig.findUnique({ where: { kind_target: { kind, target } }, select: { keyId: true } });
    if (input.enabled && !envelope && !existing?.keyId) throw new ConflictException({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURED', message: 'Indica o URL do webhook antes de ativar o canal.' });
    const data = { enabled: input.enabled, updatedById: user.id, ...(input.minSeverity ? { minSeverity: input.minSeverity } : {}), ...(envelope ?? {}) };
    const saved = await this.prisma.deliveryChannelConfig.upsert({ where: { kind_target: { kind, target } }, create: { kind, target, ...data }, update: data });
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_CHANNEL_UPDATED', entityType: 'DeliveryChannelConfig', entityId: saved.id, metadata: { kind, target, enabled: saved.enabled, minSeverity: saved.minSeverity, webhookChanged: Boolean(envelope) } });
    return this.present(target, saved);
  }

  async clearChannel(kindValue: string, targetValue: string, user: AuthenticatedUser) {
    const { kind, target } = this.parseTarget(kindValue, targetValue);
    const cleared = { enabled: false, ciphertext: null, iv: null, authTag: null, wrappedDek: null, wrapIv: null, wrapAuthTag: null, keyId: null, updatedById: user.id };
    const saved = await this.prisma.deliveryChannelConfig.upsert({ where: { kind_target: { kind, target } }, create: { kind, target, ...cleared }, update: cleared });
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_CHANNEL_CLEARED', entityType: 'DeliveryChannelConfig', entityId: saved.id, metadata: { kind, target } });
    return this.present(target, saved);
  }

  /** Sends one test message now (works before the channel is enabled) and logs it. One attempt; retry from the log if needed. */
  async sendTest(kindValue: string, targetValue: string, user: AuthenticatedUser) {
    const { kind, target } = this.parseTarget(kindValue, targetValue);
    const configured = await this.prisma.deliveryChannelConfig.findUnique({ where: { kind_target: { kind, target } }, select: { keyId: true } });
    if (!configured?.keyId) throw new ConflictException({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURED', message: 'Indica e guarda o URL do webhook antes de testar.' });
    const now = new Date();
    const row = await this.prisma.notificationDelivery.create({ data: {
      channel: kind, target, topic: TEST_TOPIC, requestedById: user.id, status: 'SENDING', attempts: 1, lastAttemptAt: now,
      title: 'Mensagem de teste', message: `Teste enviado por ${user.username} a partir de Definições → Notificações.`, href: '/definicoes?tab=notifications',
    } });
    let failureReason: string | null = null;
    try {
      await this.senders.get(kind)!.send(await this.destination(kind, target, false), this.message({ ...row, recipient: null }));
    } catch (error) { failureReason = error instanceof DeliveryError ? error.code : 'UNEXPECTED_ERROR'; }
    const status: NotificationDeliveryStatus = failureReason ? 'FAILED' : 'SENT';
    await this.prisma.notificationDelivery.update({ where: { id: row.id }, data: { status, failureReason, ...(failureReason ? {} : { sentAt: new Date() }) } });
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_CHANNEL_TESTED', entityType: 'NotificationDelivery', entityId: row.id, metadata: { kind, target, status, failureReason } });
    return { deliveryId: row.id, status, failureReason };
  }

  async deliveries(query: { status?: NotificationDeliveryStatus; target?: DeliveryTarget; cursor?: string }) {
    const cursor = query.cursor ? await this.prisma.notificationDelivery.findUnique({ where: { id: query.cursor }, select: { id: true, createdAt: true } }) : null;
    if (query.cursor && !cursor) throw new NotFoundException({ code: 'NOTIFICATION_DELIVERY_NOT_FOUND', message: 'Entrega não encontrada.' });
    const where: Prisma.NotificationDeliveryWhereInput = {
      ...(query.status ? { status: query.status } : {}), ...(query.target ? { target: query.target } : {}),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    };
    const [rows, counts] = await Promise.all([
      this.prisma.notificationDelivery.findMany({ where, take: PAGE_SIZE + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: deliverySelect }),
      this.prisma.notificationDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const items = rows.slice(0, PAGE_SIZE);
    return {
      items, nextCursor: rows.length > PAGE_SIZE ? items.at(-1)!.id : null,
      counts: Object.fromEntries((['PENDING', 'SENDING', 'SENT', 'FAILED'] as const).map((status) => [status, counts.find((row) => row.status === status)?._count._all ?? 0])),
    };
  }

  async retry(id: string, user: AuthenticatedUser) {
    const updated = await this.prisma.notificationDelivery.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() } });
    if (!updated.count) {
      if (!(await this.prisma.notificationDelivery.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException({ code: 'NOTIFICATION_DELIVERY_NOT_FOUND', message: 'Entrega não encontrada.' });
      throw new ConflictException({ code: 'NOTIFICATION_DELIVERY_NOT_FAILED', message: 'Só é possível repetir entregas falhadas.' });
    }
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_DELIVERY_RETRIED', entityType: 'NotificationDelivery', entityId: id });
    void this.kick();
    return this.prisma.notificationDelivery.findUniqueOrThrow({ where: { id }, select: deliverySelect });
  }
}
