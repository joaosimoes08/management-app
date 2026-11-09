import { PrismaClient } from '@simoes/database';

const DAY_MS = 86_400_000;
const labels: Record<string, string> = { LICENSE: 'Licença', WARRANTY: 'Garantia', SUPPORT: 'Suporte' };

export function lifecycleReminderOffsets(dueDate: Date, reminderDays: unknown, today: Date): number[] {
  const values = Array.isArray(reminderDays) ? reminderDays.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 365) : [30, 7, 0];
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysUntil = Math.round((due - now) / DAY_MS);
  return [...new Set(values.filter((offset) => offset === daysUntil))];
}

/** Creates one in-app notification per recipient/offset/date, safe for overlapping workers and retries. */
export async function deliverLifecycleReminders(prisma: PrismaClient, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 365 * DAY_MS);
  const dates = await prisma.lifecycleDate.findMany({
    where: { dueDate: { gte: start, lte: end } },
    include: {
      device: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true } },
      responsibleGroup: { select: { members: { select: { userId: true } } } },
    },
  });
  let delivered = 0;
  for (const item of dates) {
    for (const offset of lifecycleReminderOffsets(item.dueDate, item.reminderDays, start)) {
      const recipients = item.responsibleUserId
        ? [item.responsibleUserId]
        : (item.responsibleGroup?.members.map((member) => member.userId) ?? []);
      if (!recipients.length) continue;
      const title = `${labels[item.kind] ?? 'Data'} ${offset === 0 ? 'vence hoje' : `vence em ${offset} dias`}`;
      const message = `${item.device.name} · ${item.dueDate.toISOString().slice(0, 10)}`;
      for (const recipientUserId of [...new Set(recipients)]) {
        const created = await prisma.$transaction(async (tx) => {
          const result = await tx.lifecycleReminderDelivery.createMany({
            data: [{ lifecycleDateId: item.id, recipientUserId, reminderDays: offset, dueDate: item.dueDate }],
            skipDuplicates: true,
          });
          if (!result.count) return false;
          await tx.notification.create({ data: { userId: recipientUserId, type: 'LIFECYCLE_DATE', title, message } });
          return true;
        });
        if (created) delivered++;
      }
    }
  }
  return { examined: dates.length, delivered };
}
