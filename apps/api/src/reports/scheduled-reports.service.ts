import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.service';
import { isIanaTimeZone } from '../common/time-zone';
import { reportChannelsAvailable } from '../notifications/delivery/delivery-queue';
import { NotificationDeliveryService, publicLink, reportUnsubscribeHref, SCHEDULED_REPORT_TOPIC } from '../notifications/delivery/notification-delivery.service';
import { csvFilename, periodLabel, REPORT_SECTIONS, reportCsv, reportHtml, ReportSection, reportSubject, reportText, SECTION_LABELS } from './report-content';
import { ReportDefinition, ReportGeneratorService } from './report-generator.service';
import { nextRunAt, reportPeriod, ReportFrequency, ReportPeriod } from './report-schedule';

export const MAX_RECIPIENTS = 100;
export const MAX_REPORTS = 50;
const TICK_MS = 60_000;
const RUN_RETENTION_DAYS = 90;
/** Where a recipient finds their reports in the app (Teams link and e-mail button). */
export const REPORTS_PROFILE_HREF = '/perfil?tab=notifications';

export type ScheduledReportInput = {
  name: string; enabled?: boolean; frequency: ReportFrequency; dayOfWeek?: number | null; dayOfMonth?: number | null; hour: number; timezone: string;
  sections: string[]; siteIds?: string[]; recipientIds?: string[]; sendEmail?: boolean; sendTeams?: boolean;
};

const reportInclude = {
  recipients: { include: { user: { select: { id: true, username: true, displayName: true, email: true } } }, orderBy: { createdAt: 'asc' } },
  runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, trigger: true, periodStart: true, periodEnd: true, createdAt: true, _count: { select: { outputs: true } } } },
} satisfies Prisma.ScheduledReportInclude;
type ReportRecord = Prisma.ScheduledReportGetPayload<{ include: typeof reportInclude }>;

const newToken = () => randomBytes(24).toString('base64url');
const bad = (message: string) => new BadRequestException({ code: 'SCHEDULED_REPORT_INVALID', message });

@Injectable()
export class ScheduledReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledReportsService.name);
  private timer?: NodeJS.Timeout;
  private ticking: Promise<void> | null = null;
  private lastPrune = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly generator: ReportGeneratorService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  onModuleInit() {
    if (process.env.SCHEDULED_REPORTS_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.ticking?.catch(() => undefined);
  }

  // ----- Scheduling -----

  /** Sends every report whose time has come. A missed send (API down) is sent once, then the next one is scheduled. */
  tick(now = new Date()): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = (async () => {
      try {
        const due = await this.prisma.scheduledReport.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, select: { id: true, nextRunAt: true, frequency: true, dayOfWeek: true, dayOfMonth: true, hour: true, timezone: true } });
        for (const report of due) {
          // Claim the send first, so a second API instance or a slow run never sends it twice.
          const claimed = await this.prisma.scheduledReport.updateMany({ where: { id: report.id, enabled: true, nextRunAt: report.nextRunAt }, data: { nextRunAt: nextRunAt(report, now), lastRunAt: now } });
          if (!claimed.count) continue;
          try { await this.run(report.id, 'SCHEDULE', null, now); }
          catch (error) { this.logger.error(`Scheduled report ${report.id} failed: ${error instanceof Error ? error.message : 'unknown'}`); }
        }
        if (now.getTime() - this.lastPrune > 3_600_000) {
          this.lastPrune = now.getTime();
          await this.prisma.scheduledReportRun.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RUN_RETENTION_DAYS * 86_400_000) } } });
        }
      } catch (error) {
        this.logger.error(`Scheduled report check failed: ${error instanceof Error ? error.name : 'unknown'}`);
      }
    })().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  /**
   * Generates the report once per active recipient, each with only the Sites that person may read, stores the
   * output and queues the e-mail (body + CSV). Teams gets one summary post with a link and no figures: it is a
   * shared channel, and figures differ per person.
   */
  async run(id: string, trigger: 'SCHEDULE' | 'MANUAL', requestedBy: AuthenticatedUser | null, now = new Date()) {
    const report = await this.prisma.scheduledReport.findUnique({ where: { id }, include: { recipients: { where: { unsubscribedAt: null }, include: { user: { select: { id: true, email: true } } } } } });
    if (!report) throw new NotFoundException({ code: 'SCHEDULED_REPORT_NOT_FOUND', message: 'Relatório não encontrado.' });
    const period = reportPeriod(report.frequency, now, report.timezone);
    const channels = await reportChannelsAvailable(this.prisma);
    const run = await this.prisma.scheduledReportRun.create({ data: { reportId: id, trigger, periodStart: period.start, periodEnd: period.end, requestedById: requestedBy?.id ?? null } });
    const results: Array<{ userId: string; siteIds: string[]; email: 'QUEUED' | 'NO_EMAIL' | 'CHANNEL_OFF' | 'NOT_REQUESTED' | 'ERROR' }> = [];
    for (const recipient of report.recipients) {
      try {
        const user = await this.generator.identity(recipient.userId);
        if (!user) continue;
        const doc = await this.generator.build(this.definition(report), user, period, now);
        const links = { app: publicLink(REPORTS_PROFILE_HREF), unsubscribe: publicLink(reportUnsubscribeHref(recipient.unsubscribeToken)) };
        const output = await this.prisma.scheduledReportOutput.create({ data: { runId: run.id, userId: user.id, subject: reportSubject(doc), text: reportText(doc, links), html: reportHtml(doc, links), csv: reportCsv(doc), siteCount: doc.sites.length } });
        const email = !report.sendEmail ? 'NOT_REQUESTED' : !channels.email ? 'CHANNEL_OFF' : !recipient.user.email?.trim() ? 'NO_EMAIL' : 'QUEUED';
        if (email === 'QUEUED') {
          await this.prisma.notificationDelivery.create({ data: {
            channel: 'EMAIL', target: 'USER_NOTIFICATIONS', topic: SCHEDULED_REPORT_TOPIC, recipientUserId: user.id, reportOutputId: output.id,
            dedupKey: `report:${run.id}:EMAIL:${user.id}`, title: output.subject, message: `${doc.sites.length} Site(s) · ${periodLabel(doc)}`, href: REPORTS_PROFILE_HREF,
          } });
        }
        results.push({ userId: user.id, siteIds: doc.sites.map((site) => site.siteId), email });
      } catch (error) {
        this.logger.warn(`Report ${id} for recipient ${recipient.userId} failed: ${error instanceof Error ? error.name : 'unknown'}`);
        results.push({ userId: recipient.userId, siteIds: [], email: 'ERROR' });
      }
    }
    let teams: 'QUEUED' | 'CHANNEL_OFF' | 'NOT_REQUESTED' = !report.sendTeams ? 'NOT_REQUESTED' : channels.teams ? 'QUEUED' : 'CHANNEL_OFF';
    if (teams === 'QUEUED') {
      const sections = REPORT_SECTIONS.filter((section) => report.sections.includes(section)).map((section) => SECTION_LABELS[section]);
      const label = periodLabel({ periodStart: period.start.toISOString().slice(0, 10), periodEnd: new Date(period.end.getTime() - 86_400_000).toISOString().slice(0, 10) });
      await this.prisma.notificationDelivery.create({ data: {
        channel: 'TEAMS', target: 'GROUP_ALERTS', topic: SCHEDULED_REPORT_TOPIC, dedupKey: `report:${run.id}:TEAMS`,
        title: `Relatório ${report.frequency === 'WEEKLY' ? 'semanal' : 'mensal'}: ${report.name}`,
        message: `Período ${label}. Secções: ${sections.join(', ')}. Cada destinatário recebe por email apenas os Sites a que tem acesso; o relatório pode ser descarregado na aplicação.`,
        href: REPORTS_PROFILE_HREF,
      } }).catch(() => { teams = 'CHANNEL_OFF'; });
    }
    if (results.some((item) => item.email === 'QUEUED') || teams === 'QUEUED') void this.delivery.kick();
    await this.audit.record({ userId: requestedBy?.id, action: 'SCHEDULED_REPORT_RUN', entityType: 'ScheduledReport', entityId: id, metadata: { runId: run.id, trigger, periodStart: period.start.toISOString().slice(0, 10), recipients: results.length, emailsQueued: results.filter((item) => item.email === 'QUEUED').length, teams } });
    return { runId: run.id, periodStart: period.start.toISOString().slice(0, 10), periodEnd: period.end.toISOString().slice(0, 10), recipients: results, teams };
  }

  private definition(report: { id: string; name: string; frequency: ReportFrequency; timezone: string; sections: string[]; siteIds: string[] }): ReportDefinition {
    return { id: report.id, name: report.name, frequency: report.frequency, timezone: report.timezone, sections: report.sections, siteIds: report.siteIds };
  }

  /** The report as this person would get it now (on-demand download and preview). */
  async documentFor(id: string, user: AuthenticatedUser, now = new Date()) {
    const report = await this.prisma.scheduledReport.findUnique({ where: { id }, select: { id: true, name: true, frequency: true, timezone: true, sections: true, siteIds: true } });
    if (!report) throw new NotFoundException({ code: 'SCHEDULED_REPORT_NOT_FOUND', message: 'Relatório não encontrado.' });
    const period: ReportPeriod = reportPeriod(report.frequency, now, report.timezone);
    return this.generator.build(this.definition(report), user, period, now);
  }

  async csvFor(id: string, user: AuthenticatedUser) {
    const doc = await this.documentFor(id, user);
    return { filename: csvFilename(doc.reportName, doc.periodStart), body: reportCsv(doc) };
  }

  // ----- ADMIN definitions -----

  private present(report: ReportRecord) {
    const run = report.runs[0];
    return {
      id: report.id, name: report.name, enabled: report.enabled, frequency: report.frequency, dayOfWeek: report.dayOfWeek, dayOfMonth: report.dayOfMonth,
      hour: report.hour, timezone: report.timezone, sections: report.sections, siteIds: report.siteIds, sendEmail: report.sendEmail, sendTeams: report.sendTeams,
      nextRunAt: report.nextRunAt, lastRunAt: report.lastRunAt, createdAt: report.createdAt, updatedAt: report.updatedAt,
      recipients: report.recipients.map((item) => ({ userId: item.userId, username: item.user.username, displayName: item.user.displayName, hasEmail: Boolean(item.user.email?.trim()), unsubscribedAt: item.unsubscribedAt })),
      lastRun: run ? { id: run.id, trigger: run.trigger, periodStart: run.periodStart.toISOString().slice(0, 10), periodEnd: run.periodEnd.toISOString().slice(0, 10), createdAt: run.createdAt, outputs: run._count.outputs } : null,
    };
  }

  async list() {
    const [reports, users, sites, channels] = await Promise.all([
      this.prisma.scheduledReport.findMany({ include: reportInclude, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ select: { id: true, username: true, displayName: true, email: true }, orderBy: { username: 'asc' }, take: 2000 }),
      this.prisma.site.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      reportChannelsAvailable(this.prisma),
    ]);
    return {
      reports: reports.map((report) => this.present(report)),
      users: users.map((user) => ({ id: user.id, username: user.username, displayName: user.displayName, hasEmail: Boolean(user.email?.trim()) })),
      sites, channels, publicLinks: Boolean(publicLink('/')), sections: REPORT_SECTIONS, maxRecipients: MAX_RECIPIENTS,
    };
  }

  private async validate(input: ScheduledReportInput) {
    const name = input.name?.trim();
    if (!name || name.length > 120) throw bad('Indica um nome com até 120 caracteres.');
    if (input.frequency !== 'WEEKLY' && input.frequency !== 'MONTHLY') throw bad('Escolhe uma frequência semanal ou mensal.');
    if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw bad('A hora tem de estar entre 0 e 23.');
    const dayOfWeek = input.frequency === 'WEEKLY' ? input.dayOfWeek : null; const dayOfMonth = input.frequency === 'MONTHLY' ? input.dayOfMonth : null;
    if (input.frequency === 'WEEKLY' && (!Number.isInteger(dayOfWeek) || dayOfWeek! < 1 || dayOfWeek! > 7)) throw bad('Escolhe o dia da semana (segunda a domingo).');
    if (input.frequency === 'MONTHLY' && (!Number.isInteger(dayOfMonth) || dayOfMonth! < 1 || dayOfMonth! > 28)) throw bad('O dia do mês tem de estar entre 1 e 28.');
    if (!isIanaTimeZone(input.timezone)) throw bad('Fuso horário inválido.');
    const sections = REPORT_SECTIONS.filter((section) => input.sections?.includes(section));
    if (!sections.length || input.sections.some((section) => !REPORT_SECTIONS.includes(section as ReportSection))) throw bad('Escolhe pelo menos uma secção válida.');
    const siteIds = [...new Set(input.siteIds ?? [])];
    if (siteIds.length && await this.prisma.site.count({ where: { id: { in: siteIds } } }) !== siteIds.length) throw bad('Um dos Sites escolhidos não existe.');
    const recipientIds = [...new Set(input.recipientIds ?? [])];
    if (recipientIds.length > MAX_RECIPIENTS) throw bad(`No máximo ${MAX_RECIPIENTS} destinatários.`);
    if (recipientIds.length && await this.prisma.user.count({ where: { id: { in: recipientIds } } }) !== recipientIds.length) throw bad('Um dos destinatários não existe.');
    const sendEmail = input.sendEmail ?? true; const sendTeams = input.sendTeams ?? false;
    if (!sendEmail && !sendTeams) throw bad('Escolhe pelo menos um canal de envio (email ou Teams).');
    return { name, enabled: input.enabled ?? true, frequency: input.frequency, dayOfWeek: dayOfWeek ?? null, dayOfMonth: dayOfMonth ?? null, hour: input.hour, timezone: input.timezone, sections, siteIds, recipientIds, sendEmail, sendTeams };
  }

  private schedule(data: { enabled: boolean; frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string }, now = new Date()) {
    return data.enabled ? nextRunAt(data, now) : null;
  }

  async create(input: ScheduledReportInput, user: AuthenticatedUser) {
    if (await this.prisma.scheduledReport.count() >= MAX_REPORTS) throw bad(`No máximo ${MAX_REPORTS} relatórios agendados.`);
    const { recipientIds, ...data } = await this.validate(input);
    const report = await this.prisma.scheduledReport.create({
      data: { ...data, nextRunAt: this.schedule(data), createdById: user.id, updatedById: user.id, recipients: { create: recipientIds.map((userId) => ({ userId, unsubscribeToken: newToken() })) } },
      include: reportInclude,
    });
    await this.audit.record({ userId: user.id, action: 'SCHEDULED_REPORT_CREATED', entityType: 'ScheduledReport', entityId: report.id, metadata: { name: report.name, frequency: report.frequency, sections: report.sections, recipients: recipientIds.length } });
    return this.present(report);
  }

  /** Full replacement. People who unsubscribed stay unsubscribed while they remain on the list. */
  async update(id: string, input: ScheduledReportInput, user: AuthenticatedUser) {
    const current = await this.prisma.scheduledReport.findUnique({ where: { id }, select: { id: true, recipients: { select: { userId: true } } } });
    if (!current) throw new NotFoundException({ code: 'SCHEDULED_REPORT_NOT_FOUND', message: 'Relatório não encontrado.' });
    const { recipientIds, ...data } = await this.validate(input);
    const existing = new Set(current.recipients.map(({ userId }) => userId));
    const report = await this.prisma.$transaction(async (tx) => {
      await tx.scheduledReportRecipient.deleteMany({ where: { reportId: id, userId: { notIn: recipientIds } } });
      const added = recipientIds.filter((userId) => !existing.has(userId));
      if (added.length) await tx.scheduledReportRecipient.createMany({ data: added.map((userId) => ({ reportId: id, userId, unsubscribeToken: newToken() })) });
      return tx.scheduledReport.update({ where: { id }, data: { ...data, nextRunAt: this.schedule(data), updatedById: user.id }, include: reportInclude });
    });
    await this.audit.record({ userId: user.id, action: 'SCHEDULED_REPORT_UPDATED', entityType: 'ScheduledReport', entityId: id, metadata: { name: report.name, enabled: report.enabled, frequency: report.frequency, sections: report.sections, recipients: recipientIds.length } });
    return this.present(report);
  }

  async remove(id: string, user: AuthenticatedUser) {
    const current = await this.prisma.scheduledReport.findUnique({ where: { id }, select: { name: true } });
    if (!current) throw new NotFoundException({ code: 'SCHEDULED_REPORT_NOT_FOUND', message: 'Relatório não encontrado.' });
    await this.prisma.scheduledReport.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'SCHEDULED_REPORT_DELETED', entityType: 'ScheduledReport', entityId: id, metadata: { name: current.name } });
    return { success: true };
  }

  // ----- Recipients: own subscriptions and the unsubscribe link -----

  async mySubscriptions(user: AuthenticatedUser) {
    const rows = await this.prisma.scheduledReportRecipient.findMany({ where: { userId: user.id }, include: { report: { select: { id: true, name: true, enabled: true, frequency: true, dayOfWeek: true, dayOfMonth: true, hour: true, timezone: true, sendEmail: true } } }, orderBy: { createdAt: 'asc' } });
    return { items: rows.map(({ report, unsubscribedAt }) => ({ reportId: report.id, name: report.name, enabled: report.enabled, frequency: report.frequency, dayOfWeek: report.dayOfWeek, dayOfMonth: report.dayOfMonth, hour: report.hour, timezone: report.timezone, sendEmail: report.sendEmail, subscribed: !unsubscribedAt })) };
  }

  private async recipient(reportId: string, userId: string) {
    const row = await this.prisma.scheduledReportRecipient.findUnique({ where: { reportId_userId: { reportId, userId } }, select: { id: true, unsubscribedAt: true } });
    if (!row) throw new NotFoundException({ code: 'SCHEDULED_REPORT_NOT_FOUND', message: 'Não é destinatário deste relatório.' });
    return row;
  }

  async setSubscribed(reportId: string, subscribed: boolean, user: AuthenticatedUser) {
    const row = await this.recipient(reportId, user.id);
    if (subscribed === !row.unsubscribedAt) return { reportId, subscribed };
    await this.prisma.scheduledReportRecipient.update({ where: { id: row.id }, data: { unsubscribedAt: subscribed ? null : new Date() } });
    await this.audit.record({ userId: user.id, action: subscribed ? 'SCHEDULED_REPORT_SUBSCRIBED' : 'SCHEDULED_REPORT_UNSUBSCRIBED', entityType: 'ScheduledReport', entityId: reportId, metadata: { via: 'profile' } });
    return { reportId, subscribed };
  }

  /** Only recipients may preview or download a report through their subscription. */
  async assertRecipient(reportId: string, user: AuthenticatedUser) {
    await this.recipient(reportId, user.id);
  }

  private async byToken(token: string) {
    const row = typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token)
      ? await this.prisma.scheduledReportRecipient.findUnique({ where: { unsubscribeToken: token }, select: { id: true, reportId: true, userId: true, unsubscribedAt: true, report: { select: { name: true } } } })
      : null;
    if (!row) throw new NotFoundException({ code: 'REPORT_UNSUBSCRIBE_INVALID', message: 'Ligação de cancelamento inválida ou já não disponível.' });
    return row;
  }

  /** Read-only, for the confirmation page: no change on GET. */
  async unsubscribeStatus(token: string) {
    const row = await this.byToken(token);
    return { reportName: row.report.name, subscribed: !row.unsubscribedAt };
  }

  async unsubscribe(token: string) {
    const row = await this.byToken(token);
    if (!row.unsubscribedAt) {
      await this.prisma.scheduledReportRecipient.update({ where: { id: row.id }, data: { unsubscribedAt: new Date() } });
      await this.audit.record({ userId: row.userId, action: 'SCHEDULED_REPORT_UNSUBSCRIBED', entityType: 'ScheduledReport', entityId: row.reportId, metadata: { via: 'email-link' } });
    }
    return { reportName: row.report.name, subscribed: false };
  }
}
