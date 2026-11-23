import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DeliveryChannelKind, DeliveryTarget, NotificationDeliveryStatus, OperationalAlertSeverity, Prisma, PrismaClient } from '@simoes/database';
import { decryptCredential, encryptCredential, loadKeyring } from '@simoes/snmp-core';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.service';
import { DeliveryChannelSender, DeliveryDestination, DeliveryError, SmtpSettings } from './channel';
import { AlertForDelivery, GROUP_SEVERITIES, groupDeliveryReadiness, groupRecipients, isConfigured, queueAlertDelivery, smtpConfigured, TEST_TOPIC } from './delivery-queue';
import { EmailSender, isEmailAddress, normaliseRecipients, validateSmtpSettings } from './email-sender';
import { TeamsSender, validateTeamsWebhookUrl } from './teams-sender';
import { csvFilename } from '../../reports/report-content';

export const DELIVERY_SENDERS = Symbol('DELIVERY_SENDERS');

export const MAX_ATTEMPTS = 5;
/**
 * Hard cap over a delivery's whole life, manual retries included. A manual retry keeps the attempt count: it gives
 * the automatic attempts that are left (none once 5 have run, so one attempt per press) and is refused at this cap.
 */
export const MAX_TOTAL_ATTEMPTS = 10;
/** Wait after attempt N fails (index N-1). Attempt 5 is the last. */
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
/** Poll interval: well under a minute so a queued CRITICAL alert is posted within 1 min even if the immediate kick is missed. */
export const DEFAULT_POLL_MS = 15_000;
const STALE_SENDING_MS = 120_000;
const BATCH = 25;
const RETENTION_DAYS = 90;
const PAGE_SIZE = 50;

export type SmtpInput = { host: string; port: number; security: string; username?: string | null; password?: string; from: string };
export type ChannelSettingsInput = { enabled: boolean; webhookUrl?: string; minSeverity?: OperationalAlertSeverity; smtp?: SmtpInput; recipients?: string[] };

type ConfigRecord = {
  id: string; kind: DeliveryChannelKind; target: DeliveryTarget; enabled: boolean; keyId: string | null; minSeverity: OperationalAlertSeverity | null;
  settings: Prisma.JsonValue; updatedAt: Date; ciphertext: Uint8Array | null; iv: Uint8Array | null; authTag: Uint8Array | null;
  wrappedDek: Uint8Array | null; wrapIv: Uint8Array | null; wrapAuthTag: Uint8Array | null;
};
/** Channel-wide part of a destination (decrypted once per drain); the e-mail recipient is added per row. */
type ResolvedChannel = { kind: 'TEAMS'; webhookUrl: string } | { kind: 'EMAIL'; smtp: SmtpSettings; password: string | null; recipients: string[] };

const SMTP_ERRORS: Record<string, string> = {
  SMTP_HOST_INVALID: 'Indica um servidor SMTP válido (nome ou endereço IP, sem protocolo).',
  SMTP_PORT_INVALID: 'Indica uma porta entre 1 e 65535.',
  SMTP_SECURITY_INVALID: 'Escolhe TLS, STARTTLS ou sem encriptação.',
  SMTP_USERNAME_INVALID: 'O utilizador SMTP não é válido.',
  SMTP_AUTH_NEEDS_TLS: 'Com utilizador ou palavra-passe, a ligação tem de usar TLS ou STARTTLS.',
  SMTP_FROM_INVALID: 'Indica um endereço de remetente válido (por exemplo alertas@empresa.pt).',
  SMTP_HOST_NOT_ALLOWED: 'Este servidor SMTP não é permitido (loopback, link-local ou endereço não especificado).',
};

const deliverySelect = {
  id: true, channel: true, target: true, status: true, topic: true, title: true, attempts: true, failureReason: true,
  nextAttemptAt: true, lastAttemptAt: true, sentAt: true, createdAt: true, alertId: true,
  recipient: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.NotificationDeliverySelect;

export function pollIntervalMs(value = process.env.NOTIFICATION_DELIVERY_POLL_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 30_000 ? parsed : DEFAULT_POLL_MS;
}

/** Step 32 scheduled reports: queued by ReportsModule, carried here with the generated body and CSV. */
export const SCHEDULED_REPORT_TOPIC = 'SCHEDULED_REPORT';
/** Web page that asks for confirmation before unsubscribing (a GET never changes anything). */
export const reportUnsubscribeHref = (token: string) => `/relatorios/cancelar-subscricao?token=${encodeURIComponent(token)}`;

type ReportOutputForSend = { text: string; html: string; csv: string; userId: string | null; run: { reportId: string; periodStart: Date; report: { name: string } } };

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
    this.senders = new Map((senders ?? [new TeamsSender(), new EmailSender()]).map((sender) => [sender.kind as DeliveryChannelKind, sender]));
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
    const destinations = new Map<string, ResolvedChannel | DeliveryError>();
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

  private decrypt(config: ConfigRecord) {
    if (!config.keyId || !config.ciphertext || !config.iv || !config.authTag || !config.wrappedDek || !config.wrapIv || !config.wrapAuthTag) return null;
    let keyring;
    try { keyring = loadKeyring(); } catch { throw new DeliveryError('KEYRING_UNAVAILABLE', true); }
    try { return decryptCredential(config as never, keyring); } catch { throw new DeliveryError('SECRET_UNREADABLE', false); }
  }

  /** Decrypts what a channel needs to send. `requireEnabled` is false only for test messages. */
  private async resolveChannel(kind: DeliveryChannelKind, target: DeliveryTarget, requireEnabled: boolean): Promise<ResolvedChannel> {
    const rows = await this.prisma.deliveryChannelConfig.findMany({ where: { kind } }) as ConfigRecord[];
    const row = rows.find((item) => item.target === target);
    const server = kind === 'EMAIL' ? rows.find((item) => item.target === 'USER_NOTIFICATIONS') : undefined;
    if (!row || !isConfigured(row, server)) throw new DeliveryError('CHANNEL_NOT_CONFIGURED', false);
    if (requireEnabled && !row.enabled) throw new DeliveryError('CHANNEL_DISABLED', false);
    if (kind === 'TEAMS') {
      const url = this.decrypt(row)?.webhookUrl;
      if (!url) throw new DeliveryError('SECRET_UNREADABLE', false);
      return { kind, webhookUrl: url };
    }
    const settings = server!.settings as unknown as SmtpSettings;
    const smtp: SmtpSettings = { host: settings.host, port: settings.port, security: settings.security, username: settings.username ?? null, from: settings.from };
    const password = smtp.username ? this.decrypt(server!)?.password ?? null : null;
    return { kind, smtp, password, recipients: target === 'GROUP_ALERTS' ? groupRecipients(row) : [] };
  }

  /** Personal e-mail goes to the recipient's current address; a test goes to the ADMIN who asked for it. */
  private async destinationFor(channel: ResolvedChannel, row: { target: DeliveryTarget; topic: string; recipientUserId: string | null; requestedById: string | null }): Promise<DeliveryDestination> {
    if (channel.kind === 'TEAMS') return channel;
    let to = channel.recipients;
    if (row.target === 'USER_NOTIFICATIONS') {
      const userId = row.topic === TEST_TOPIC ? row.requestedById : row.recipientUserId;
      const email = userId ? (await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email?.trim() : null;
      to = email && isEmailAddress(email) ? [email] : [];
      if (!to.length) throw new DeliveryError('RECIPIENT_NO_EMAIL', false);
    }
    return { kind: 'EMAIL', smtp: channel.smtp, password: channel.password, to, bcc: row.target === 'GROUP_ALERTS' };
  }

  private async attempt(id: string, cache: Map<string, ResolvedChannel | DeliveryError>, now: () => Date) {
    const startedAt = now();
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: startedAt } },
      data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: startedAt },
    });
    if (!claimed.count) return;
    const row = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id }, include: {
        recipient: { select: { username: true, displayName: true } },
        reportOutput: { select: { text: true, html: true, csv: true, userId: true, run: { select: { reportId: true, periodStart: true, report: { select: { name: true } } } } } },
      },
    });
    try {
      const report = row.topic === SCHEDULED_REPORT_TOPIC && row.channel === 'EMAIL' ? await this.reportExtras(row.reportOutput) : {};
      const sender = this.senders.get(row.channel);
      if (!sender) throw new DeliveryError('CHANNEL_UNSUPPORTED', false);
      const cacheKey = `${row.channel}:${row.target}`;
      if (!cache.has(cacheKey)) {
        try { cache.set(cacheKey, await this.resolveChannel(row.channel, row.target, row.topic !== TEST_TOPIC)); }
        catch (error) { cache.set(cacheKey, error instanceof DeliveryError ? error : new DeliveryError('CHANNEL_ERROR', true)); }
      }
      const channel = cache.get(cacheKey)!;
      if (channel instanceof DeliveryError) throw channel;
      await sender.send(await this.destinationFor(channel, row), { ...this.message(row), ...report });
      await this.prisma.notificationDelivery.update({ where: { id }, data: { status: 'SENT', sentAt: now(), failureReason: null } });
    } catch (error) {
      const failure = error instanceof DeliveryError ? error : new DeliveryError('UNEXPECTED_ERROR', true);
      const outcome = failureOutcome(row.attempts, failure.retryable, now());
      await this.prisma.notificationDelivery.update({ where: { id }, data: { ...outcome, failureReason: failure.code } });
      this.logger.warn(`Delivery ${id} attempt ${row.attempts} failed: ${failure.code}${outcome.status === 'PENDING' ? '; retry scheduled' : ''}`);
    }
  }

  /**
   * A report e-mail carries its generated body and CSV. It is not sent once the report was deleted or the person
   * unsubscribed after it was queued.
   */
  private async reportExtras(output: ReportOutputForSend | null) {
    if (!output?.userId) throw new DeliveryError('REPORT_REMOVED', false);
    const recipient = await this.prisma.scheduledReportRecipient.findUnique({ where: { reportId_userId: { reportId: output.run.reportId, userId: output.userId } }, select: { unsubscribeToken: true, unsubscribedAt: true } });
    if (!recipient || recipient.unsubscribedAt) throw new DeliveryError('REPORT_UNSUBSCRIBED', false);
    return {
      body: { text: output.text, html: output.html },
      attachments: [{ filename: csvFilename(output.run.report.name, output.run.periodStart.toISOString().slice(0, 10)), content: output.csv, contentType: 'text/csv; charset=utf-8' }],
      unsubscribeUrl: publicLink(reportUnsubscribeHref(recipient.unsubscribeToken)),
    };
  }

  private message(row: { channel: DeliveryChannelKind; title: string; message: string; href: string | null; target: DeliveryTarget; recipient: { username: string; displayName: string | null } | null }) {
    const severity = row.target === 'GROUP_ALERTS' ? /^\[(CRITICAL|HIGH|WARNING|INFO)\]/.exec(row.title)?.[1] ?? null : null;
    return {
      title: row.title, message: row.message, url: publicLink(row.href), severity,
      recipientLabel: row.recipient && row.channel === 'TEAMS' ? (row.recipient.displayName ? `${row.recipient.displayName} (${row.recipient.username})` : row.recipient.username) : null,
    };
  }

  // ----- ADMIN settings -----

  private parseTarget(kind: string, target: string) {
    if (kind !== 'TEAMS' && kind !== 'EMAIL') throw new NotFoundException({ code: 'NOTIFICATION_CHANNEL_UNKNOWN', message: 'Canal de entrega desconhecido.' });
    if (target !== 'USER_NOTIFICATIONS' && target !== 'GROUP_ALERTS') throw new NotFoundException({ code: 'NOTIFICATION_CHANNEL_UNKNOWN', message: 'Destino de entrega desconhecido.' });
    return { kind: kind as DeliveryChannelKind, target: target as DeliveryTarget };
  }

  /** Public view of a config row: never the ciphertext, webhook URL or SMTP password, only whether one is stored. */
  private present(kind: DeliveryChannelKind, target: DeliveryTarget, config: ConfigRecord | null, server: ConfigRecord | null) {
    const base = {
      kind, target, enabled: Boolean(config?.enabled), configured: isConfigured(config, server),
      // SNMP Phase 1 step 1.2: the saved value only; null means not chosen yet, and then this channel sends nothing.
      minSeverity: target === 'GROUP_ALERTS' ? config?.minSeverity ?? null : null,
      ...(target === 'GROUP_ALERTS' ? { delivery: groupDeliveryReadiness(config as never, server as never) } : {}),
      updatedAt: config?.updatedAt ?? null,
    };
    if (kind === 'TEAMS') return base;
    if (target === 'GROUP_ALERTS') return { ...base, recipients: groupRecipients(config), serverConfigured: smtpConfigured(server) };
    const settings = (smtpConfigured(config) ? config!.settings : null) as unknown as SmtpSettings | null;
    return {
      ...base,
      smtp: settings ? { host: settings.host, port: settings.port, security: settings.security, username: settings.username ?? null, from: settings.from, passwordSet: Boolean(config?.keyId) } : null,
    };
  }

  private async configs(kind?: DeliveryChannelKind) {
    return this.prisma.deliveryChannelConfig.findMany({ where: kind ? { kind } : {} }) as Promise<ConfigRecord[]>;
  }

  private presentFrom(rows: ConfigRecord[], kind: DeliveryChannelKind, target: DeliveryTarget) {
    const find = (t: DeliveryTarget) => rows.find((row) => row.kind === kind && row.target === t) ?? null;
    return this.present(kind, target, find(target), kind === 'EMAIL' ? find('USER_NOTIFICATIONS') : null);
  }

  async channels() {
    const rows = await this.configs();
    let keyringAvailable = true;
    try { loadKeyring(); } catch { keyringAvailable = false; }
    const pairs: [DeliveryChannelKind, DeliveryTarget][] = [['TEAMS', 'USER_NOTIFICATIONS'], ['TEAMS', 'GROUP_ALERTS'], ['EMAIL', 'USER_NOTIFICATIONS'], ['EMAIL', 'GROUP_ALERTS']];
    const channels = pairs.map(([kind, target]) => this.presentFrom(rows, kind, target));
    return {
      channels,
      // SNMP Phase 1 step 1.2: true when no group channel can send operational alerts (no destination and/or no
      // minimum severity saved), so the setup page can warn that alerts go nowhere.
      groupAlertsUnconfigured: !channels.some((channel) => 'delivery' in channel && channel.delivery?.ready),
      keyringAvailable, publicLinks: Boolean(publicLink('/', process.env.APP_PUBLIC_URL)), maxAttempts: MAX_ATTEMPTS, maxTotalAttempts: MAX_TOTAL_ATTEMPTS,
    };
  }

  private encrypt(secret: Record<string, string>) {
    try { return encryptCredential(secret, loadKeyring()); }
    catch { throw new ConflictException({ code: 'NOTIFICATION_KEYRING_UNAVAILABLE', message: 'O cofre de credenciais não está configurado.' }); }
  }

  async updateChannel(kindValue: string, targetValue: string, input: ChannelSettingsInput, user: AuthenticatedUser) {
    const { kind, target } = this.parseTarget(kindValue, targetValue);
    if (input.minSeverity !== undefined && (target !== 'GROUP_ALERTS' || !(GROUP_SEVERITIES as readonly string[]).includes(input.minSeverity))) {
      throw new BadRequestException({ code: 'NOTIFICATION_CHANNEL_SEVERITY_INVALID', message: 'A severidade mínima só se aplica ao canal de grupo e tem de ser CRITICAL ou HIGH.' });
    }
    const misplaced = (kind === 'TEAMS' && (input.smtp || input.recipients)) || (kind === 'EMAIL' && input.webhookUrl !== undefined)
      || (kind === 'EMAIL' && target === 'USER_NOTIFICATIONS' && input.recipients) || (kind === 'EMAIL' && target === 'GROUP_ALERTS' && input.smtp);
    if (misplaced) throw new BadRequestException({ code: 'NOTIFICATION_CHANNEL_FIELD_INVALID', message: 'Este campo não se aplica a este canal.' });

    const rows = await this.configs(kind);
    const existing = rows.find((row) => row.target === target) ?? null;
    const server = kind === 'EMAIL' ? rows.find((row) => row.target === 'USER_NOTIFICATIONS') ?? null : null;
    const data: Prisma.DeliveryChannelConfigUncheckedUpdateInput = { enabled: input.enabled, updatedById: user.id, ...(input.minSeverity ? { minSeverity: input.minSeverity } : {}) };
    const changes: Record<string, unknown> = {};

    if (kind === 'TEAMS' && input.webhookUrl !== undefined && input.webhookUrl.trim() !== '') {
      let url: string;
      try { url = validateTeamsWebhookUrl(input.webhookUrl); }
      catch { throw new BadRequestException({ code: 'TEAMS_WEBHOOK_INVALID', message: 'Indica o URL HTTPS de um webhook do Microsoft Teams (webhook.office.com ou Workflows).' }); }
      Object.assign(data, this.encrypt({ webhookUrl: url }));
      changes.webhookChanged = true;
    }
    if (input.smtp) {
      const newPassword = input.smtp.password !== undefined && input.smtp.password !== '' ? input.smtp.password : null;
      let smtp: SmtpSettings;
      try { smtp = validateSmtpSettings(input.smtp, Boolean(newPassword)); }
      catch (error) {
        const code = error instanceof DeliveryError ? error.code : 'SMTP_SETTINGS_INVALID';
        throw new BadRequestException({ code, message: SMTP_ERRORS[code] ?? 'Definições SMTP inválidas.' });
      }
      if (newPassword && !smtp.username) throw new BadRequestException({ code: 'SMTP_USERNAME_REQUIRED', message: 'Indica o utilizador SMTP para usar uma palavra-passe.' });
      // The stored password belongs to one server and account: it is never carried over to another host, port,
      // security mode or username. Such a change needs the password again; removing the username clears it.
      const previous = (existing?.settings ?? null) as Partial<SmtpSettings> | null;
      // Host names are case-insensitive: a case-only change is the same server, and older rows may hold mixed case.
      const connectionChanged = !previous || (previous.host ?? '').toLowerCase() !== smtp.host.toLowerCase() ||previous.port !== smtp.port || previous.security !== smtp.security || (previous.username ?? null) !== smtp.username;
      if (!newPassword && smtp.username && existing?.keyId && connectionChanged) {
        throw new BadRequestException({ code: 'SMTP_PASSWORD_REENTRY_REQUIRED', message: 'Alteraste o servidor, a porta, a segurança ou o utilizador: introduz de novo a palavra-passe SMTP.' });
      }
      data.settings = smtp as unknown as Prisma.InputJsonValue;
      if (newPassword) { Object.assign(data, this.encrypt({ password: newPassword })); changes.passwordChanged = true; }
      else if (!smtp.username || connectionChanged) Object.assign(data, { ciphertext: null, iv: null, authTag: null, wrappedDek: null, wrapIv: null, wrapAuthTag: null, keyId: null });
      changes.smtp = { host: smtp.host, port: smtp.port, security: smtp.security, username: smtp.username, from: smtp.from };
    }
    if (input.recipients) {
      let recipients: string[];
      try { recipients = normaliseRecipients(input.recipients); }
      catch { throw new BadRequestException({ code: 'EMAIL_RECIPIENTS_INVALID', message: 'Indica entre 1 e 20 endereços de email válidos.' }); }
      data.settings = { recipients } as Prisma.InputJsonValue;
      changes.recipientCount = recipients.length;
    }

    const after = { ...existing, ...data, kind, target } as unknown as ConfigRecord;
    if (input.enabled && !isConfigured(after, kind === 'EMAIL' && target === 'USER_NOTIFICATIONS' ? after : server)) {
      const message = kind === 'TEAMS' ? 'Indica o URL do webhook antes de ativar o canal.'
        : target === 'USER_NOTIFICATIONS' ? 'Configura o servidor SMTP antes de ativar o envio por email.'
          : smtpConfigured(server) ? 'Indica os destinatários antes de ativar os alertas por email.' : 'Configura o servidor SMTP antes de ativar os alertas por email.';
      throw new ConflictException({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURED', message });
    }
    const saved = await this.prisma.deliveryChannelConfig.upsert({
      where: { kind_target: { kind, target } },
      create: { ...(data as Prisma.DeliveryChannelConfigUncheckedCreateInput), kind, target },
      update: data,
    }) as ConfigRecord;
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_CHANNEL_UPDATED', entityType: 'DeliveryChannelConfig', entityId: saved.id, metadata: { kind, target, enabled: saved.enabled, minSeverity: saved.minSeverity, ...changes } as Prisma.InputJsonValue });
    return this.present(kind, target, saved, kind === 'EMAIL' && target === 'GROUP_ALERTS' ? server : kind === 'EMAIL' ? saved : null);
  }

  async clearChannel(kindValue: string, targetValue: string, user: AuthenticatedUser) {
    const { kind, target } = this.parseTarget(kindValue, targetValue);
    const cleared = { enabled: false, settings: Prisma.DbNull, ciphertext: null, iv: null, authTag: null, wrappedDek: null, wrapIv: null, wrapAuthTag: null, keyId: null, updatedById: user.id };
    const saved = await this.prisma.deliveryChannelConfig.upsert({ where: { kind_target: { kind, target } }, create: { kind, target, ...cleared }, update: cleared }) as ConfigRecord;
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_CHANNEL_CLEARED', entityType: 'DeliveryChannelConfig', entityId: saved.id, metadata: { kind, target } });
    const rows = await this.configs(kind);
    return this.presentFrom(rows, kind, target);
  }

  /** Sends one test message now (works before the channel is enabled) and logs it. One attempt; retry from the log if needed. */
  async sendTest(kindValue: string, targetValue: string, user: AuthenticatedUser) {
    const { kind, target } = this.parseTarget(kindValue, targetValue);
    const rows = await this.configs(kind);
    const row = rows.find((item) => item.target === target) ?? null;
    if (!isConfigured(row, kind === 'EMAIL' ? rows.find((item) => item.target === 'USER_NOTIFICATIONS') ?? null : null)) {
      const message = kind === 'TEAMS' ? 'Indica e guarda o URL do webhook antes de testar.' : 'Guarda o servidor SMTP (e os destinatários, para alertas) antes de testar.';
      throw new ConflictException({ code: 'NOTIFICATION_CHANNEL_NOT_CONFIGURED', message });
    }
    if (kind === 'EMAIL' && target === 'USER_NOTIFICATIONS') {
      const me = await this.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
      if (!me?.email || !isEmailAddress(me.email.trim())) throw new ConflictException({ code: 'NOTIFICATION_TEST_NO_EMAIL', message: 'O teu utilizador não tem email. O email de teste é enviado para o teu endereço.' });
    }
    const now = new Date();
    const delivery = await this.prisma.notificationDelivery.create({ data: {
      channel: kind, target, topic: TEST_TOPIC, requestedById: user.id, status: 'SENDING', attempts: 1, lastAttemptAt: now,
      title: kind === 'EMAIL' ? 'Email de teste' : 'Mensagem de teste', message: `Teste enviado por ${user.username} a partir de Definições → Notificações.`, href: '/definicoes?tab=notifications',
    } });
    let failureReason: string | null = null;
    try {
      const channel = await this.resolveChannel(kind, target, false);
      await this.senders.get(kind)!.send(await this.destinationFor(channel, delivery), this.message({ ...delivery, recipient: null }));
    } catch (error) { failureReason = error instanceof DeliveryError ? error.code : 'UNEXPECTED_ERROR'; }
    const status: NotificationDeliveryStatus = failureReason ? 'FAILED' : 'SENT';
    await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status, failureReason, ...(failureReason ? {} : { sentAt: new Date() }) } });
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_CHANNEL_TESTED', entityType: 'NotificationDelivery', entityId: delivery.id, metadata: { kind, target, status, failureReason } });
    return { deliveryId: delivery.id, status, failureReason };
  }

  async deliveries(query: { status?: NotificationDeliveryStatus; target?: DeliveryTarget; channel?: DeliveryChannelKind; cursor?: string }) {
    const cursor = query.cursor ? await this.prisma.notificationDelivery.findUnique({ where: { id: query.cursor }, select: { id: true, createdAt: true } }) : null;
    if (query.cursor && !cursor) throw new NotFoundException({ code: 'NOTIFICATION_DELIVERY_NOT_FOUND', message: 'Entrega não encontrada.' });
    const where: Prisma.NotificationDeliveryWhereInput = {
      ...(query.status ? { status: query.status } : {}), ...(query.target ? { target: query.target } : {}), ...(query.channel ? { channel: query.channel } : {}),
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
    // The attempt count is kept (see MAX_TOTAL_ATTEMPTS), so manual retries cannot loop a delivery forever.
    const updated = await this.prisma.notificationDelivery.updateMany({ where: { id, status: 'FAILED', attempts: { lt: MAX_TOTAL_ATTEMPTS } }, data: { status: 'PENDING', nextAttemptAt: new Date() } });
    if (!updated.count) {
      const row = await this.prisma.notificationDelivery.findUnique({ where: { id }, select: { status: true, attempts: true } });
      if (!row) throw new NotFoundException({ code: 'NOTIFICATION_DELIVERY_NOT_FOUND', message: 'Entrega não encontrada.' });
      if (row.status === 'FAILED') throw new ConflictException({ code: 'NOTIFICATION_DELIVERY_RETRY_LIMIT', message: `Esta entrega já teve ${MAX_TOTAL_ATTEMPTS} tentativas e não pode ser repetida.` });
      throw new ConflictException({ code: 'NOTIFICATION_DELIVERY_NOT_FAILED', message: 'Só é possível repetir entregas falhadas.' });
    }
    await this.audit.record({ userId: user.id, action: 'NOTIFICATION_DELIVERY_RETRIED', entityType: 'NotificationDelivery', entityId: id });
    void this.kick();
    return this.prisma.notificationDelivery.findUniqueOrThrow({ where: { id }, select: deliverySelect });
  }
}
