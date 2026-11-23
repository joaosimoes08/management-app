import type { DeliveryChannelKind, DeliveryTarget, OperationalAlertSeverity, Prisma, PrismaClient } from '@simoes/database';
import { ALERT_SEVERITY_RANK, alertPolicyDecision } from '../../operations/alert-policy';
import type { NotificationTopic } from '../notification-preferences';

export const OPERATIONAL_ALERT_TOPIC = 'OPERATIONAL_ALERT';
export const TEST_TOPIC = 'TEST';
/**
 * SNMP Phase 1 step 1.2: there is no default destination or severity in code. A group channel sends only when the
 * setup page has saved both its destination and its minimum severity; until then nothing is sent and
 * groupDeliveryReadiness tells the setup page what is missing.
 */
export const GROUP_SEVERITIES = ['CRITICAL', 'HIGH'] as const;

type Db = Prisma.TransactionClient | PrismaClient;
export type UserNotice = { userId: string; type: NotificationTopic; title: string; message: string; href?: string | null };
export const DELIVERY_KINDS: DeliveryChannelKind[] = ['TEAMS', 'EMAIL'];
export type ChannelAvailability = Record<'teams' | 'email', boolean>;

type ConfigRow = { kind: DeliveryChannelKind; target: DeliveryTarget; enabled: boolean; keyId: string | null; minSeverity: OperationalAlertSeverity | null; settings: Prisma.JsonValue };

const settingsOf = (row: { settings: Prisma.JsonValue } | null | undefined) =>
  (row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings : {}) as Record<string, unknown>;

/** The SMTP server lives on EMAIL/USER_NOTIFICATIONS. Configured = host and from address saved. */
export function smtpConfigured(server: { settings: Prisma.JsonValue } | null | undefined) {
  const settings = settingsOf(server);
  return typeof settings.host === 'string' && Boolean(settings.host) && typeof settings.from === 'string' && Boolean(settings.from);
}

export function groupRecipients(row: { settings: Prisma.JsonValue } | null | undefined) {
  const recipients = settingsOf(row).recipients;
  return Array.isArray(recipients) ? recipients.filter((value): value is string => typeof value === 'string') : [];
}

/** Whether a config row holds everything needed to send (independent of `enabled`). */
export function isConfigured(row: ConfigRow | null | undefined, server: ConfigRow | null | undefined) {
  if (!row) return false;
  if (row.kind === 'TEAMS') return Boolean(row.keyId);
  if (row.target === 'USER_NOTIFICATIONS') return smtpConfigured(row);
  return groupRecipients(row).length > 0 && smtpConfigured(server);
}

async function configRows(db: Db) {
  return db.deliveryChannelConfig.findMany({ select: { kind: true, target: true, enabled: true, keyId: true, minSeverity: true, settings: true } });
}

export type GroupDeliveryMissing = 'enabled' | 'destination' | 'minSeverity';

/** What a group channel still needs before it sends anything (empty = ready). Order is stable for the UI. */
export function groupDeliveryReadiness(row: ConfigRow | null | undefined, server: ConfigRow | null | undefined) {
  const missing: GroupDeliveryMissing[] = [];
  if (!row?.enabled) missing.push('enabled');
  if (!isConfigured(row, server)) missing.push('destination');
  if (!row?.minSeverity) missing.push('minSeverity');
  return { ready: missing.length === 0, missing };
}

/** Usable = enabled and holding everything it needs to send. */
function usable(rows: ConfigRow[], kind: DeliveryChannelKind, target: DeliveryTarget) {
  const row = rows.find((item) => item.kind === kind && item.target === target);
  const server = rows.find((item) => item.kind === 'EMAIL' && item.target === 'USER_NOTIFICATIONS');
  return row?.enabled && isConfigured(row, server) ? row : null;
}

export async function channelsAvailableForUsers(db: Db): Promise<ChannelAvailability> {
  const rows = await configRows(db);
  return { teams: Boolean(usable(rows, 'TEAMS', 'USER_NOTIFICATIONS')), email: Boolean(usable(rows, 'EMAIL', 'USER_NOTIFICATIONS')) };
}

/** Step 32: which channels a scheduled report can go out on now (personal e-mail, Teams operational channel). */
export async function reportChannelsAvailable(db: Db) {
  const rows = await configRows(db);
  return { email: Boolean(usable(rows, 'EMAIL', 'USER_NOTIFICATIONS')), teams: Boolean(usable(rows, 'TEAMS', 'GROUP_ALERTS')) };
}

/**
 * Queues external copies of in-app notifications for users who opted in, per channel. Call inside the same
 * transaction that creates the notifications, so a rolled-back notification never gets an external copy.
 * Only inserts rows: sending happens later in NotificationDeliveryService and never blocks the caller.
 */
export async function queueUserDeliveries(db: Db, notices: UserNotice[]) {
  if (!notices.length) return 0;
  const rows = await configRows(db);
  const kinds = DELIVERY_KINDS.filter((kind) => usable(rows, kind, 'USER_NOTIFICATIONS'));
  if (!kinds.length) return 0;
  const optedIn = new Set((await db.notificationChannelPreference.findMany({
    where: { channel: { in: kinds }, OR: notices.map(({ userId, type }) => ({ userId, type })) },
    select: { userId: true, type: true, channel: true },
  })).map(({ userId, type, channel }) => `${channel}:${userId}:${type}`));
  const data = kinds.flatMap((channel) => notices.filter(({ userId, type }) => optedIn.has(`${channel}:${userId}:${type}`)).map((notice) => ({
    channel, target: 'USER_NOTIFICATIONS' as const, topic: notice.type, recipientUserId: notice.userId,
    title: notice.title, message: notice.message, href: notice.href ?? null,
  })));
  if (data.length) await db.notificationDelivery.createMany({ data });
  return data.length;
}

export type AlertForDelivery = {
  id: string; source: string; severity: OperationalAlertSeverity; siteId: string | null; title: string; detail: string;
  actionHref: string | null; firstOccurredAt: Date; lastOccurredAt: Date;
};

/**
 * Queues one group-channel post when an operational alert opens or reopens at or above the configured
 * severity. CRITICAL always passes; HIGH follows the same maintenance and threshold rules as the Alertas list.
 * `occurrence` identifies the opening, so repeats of the same open alert are not posted again.
 */
export async function queueAlertDelivery(db: Db, alert: AlertForDelivery, occurrence: Date, now = new Date()) {
  const rows = await configRows(db);
  const kinds = DELIVERY_KINDS.filter((kind) => {
    const config = usable(rows, kind, 'GROUP_ALERTS');
    if (!config?.minSeverity) return false;
    return (ALERT_SEVERITY_RANK[alert.severity] ?? 99) <= (ALERT_SEVERITY_RANK[config.minSeverity] ?? -1);
  });
  if (!kinds.length) return false;
  if (alert.severity !== 'CRITICAL') {
    const [rules, windows] = await Promise.all([
      db.alertRule.findMany({ where: { enabled: true }, select: { source: true, siteId: true, minSeverity: true } }),
      db.maintenanceWindow.findMany({ where: { startsAt: { lte: now }, endsAt: { gt: now } }, select: { siteId: true } }),
    ]);
    if (alertPolicyDecision(rules, windows, alert) !== 'SHOWN') return false;
  }
  const site = alert.siteId ? await db.site.findUnique({ where: { id: alert.siteId }, select: { name: true } }) : null;
  const created = await db.notificationDelivery.createMany({
    data: kinds.map((channel) => ({
      channel, target: 'GROUP_ALERTS' as const, topic: OPERATIONAL_ALERT_TOPIC, alertId: alert.id,
      dedupKey: `alert:${channel}:${alert.id}:${occurrence.toISOString()}`,
      title: `[${alert.severity}] ${alert.title}`,
      message: [site?.name, alert.detail].filter(Boolean).join(' · '),
      href: alert.actionHref ?? `/alertas?alertId=${alert.id}`,
    })),
    skipDuplicates: true,
  });
  return created.count > 0;
}
