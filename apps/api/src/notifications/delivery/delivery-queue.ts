import type { OperationalAlertSeverity, Prisma, PrismaClient } from '@simoes/database';
import { ALERT_SEVERITY_RANK, alertPolicyDecision } from '../../operations/alert-policy';
import type { NotificationTopic } from '../notification-preferences';

export const OPERATIONAL_ALERT_TOPIC = 'OPERATIONAL_ALERT';
export const TEST_TOPIC = 'TEST';
export const DEFAULT_GROUP_MIN_SEVERITY: OperationalAlertSeverity = 'HIGH';
export const GROUP_SEVERITIES = ['CRITICAL', 'HIGH'] as const;

type Db = Prisma.TransactionClient | PrismaClient;
export type UserNotice = { userId: string; type: NotificationTopic; title: string; message: string; href?: string | null };

/** Usable = enabled and holding a stored destination. */
async function usableConfig(db: Db, target: 'USER_NOTIFICATIONS' | 'GROUP_ALERTS') {
  const config = await db.deliveryChannelConfig.findUnique({ where: { kind_target: { kind: 'TEAMS', target } }, select: { enabled: true, keyId: true, minSeverity: true } });
  return config?.enabled && config.keyId ? config : null;
}

export async function teamsAvailableForUsers(db: Db) {
  return Boolean(await usableConfig(db, 'USER_NOTIFICATIONS'));
}

/**
 * Queues external copies of in-app notifications for users who opted in. Call inside the same transaction
 * that creates the notifications, so a rolled-back notification never gets an external copy.
 * Only inserts rows: sending happens later in NotificationDeliveryService and never blocks the caller.
 */
export async function queueUserDeliveries(db: Db, notices: UserNotice[]) {
  if (!notices.length || !(await usableConfig(db, 'USER_NOTIFICATIONS'))) return 0;
  const optedIn = new Set((await db.notificationChannelPreference.findMany({
    where: { channel: 'TEAMS', OR: notices.map(({ userId, type }) => ({ userId, type })) },
    select: { userId: true, type: true },
  })).map(({ userId, type }) => `${userId}:${type}`));
  const data = notices.filter(({ userId, type }) => optedIn.has(`${userId}:${type}`)).map((notice) => ({
    channel: 'TEAMS' as const, target: 'USER_NOTIFICATIONS' as const, topic: notice.type, recipientUserId: notice.userId,
    title: notice.title, message: notice.message, href: notice.href ?? null,
  }));
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
  const config = await usableConfig(db, 'GROUP_ALERTS');
  if (!config) return false;
  const threshold = config.minSeverity ?? DEFAULT_GROUP_MIN_SEVERITY;
  if ((ALERT_SEVERITY_RANK[alert.severity] ?? 99) > (ALERT_SEVERITY_RANK[threshold] ?? 0)) return false;
  if (alert.severity !== 'CRITICAL') {
    const [rules, windows] = await Promise.all([
      db.alertRule.findMany({ where: { enabled: true }, select: { source: true, siteId: true, minSeverity: true } }),
      db.maintenanceWindow.findMany({ where: { startsAt: { lte: now }, endsAt: { gt: now } }, select: { siteId: true } }),
    ]);
    if (alertPolicyDecision(rules, windows, alert) !== 'SHOWN') return false;
  }
  const site = alert.siteId ? await db.site.findUnique({ where: { id: alert.siteId }, select: { name: true } }) : null;
  const created = await db.notificationDelivery.createMany({
    data: [{
      channel: 'TEAMS', target: 'GROUP_ALERTS', topic: OPERATIONAL_ALERT_TOPIC, alertId: alert.id,
      dedupKey: `alert:${alert.id}:${occurrence.toISOString()}`,
      title: `[${alert.severity}] ${alert.title}`,
      message: [site?.name, alert.detail].filter(Boolean).join(' · '),
      href: alert.actionHref ?? `/alertas?alertId=${alert.id}`,
    }],
    skipDuplicates: true,
  });
  return created.count > 0;
}
