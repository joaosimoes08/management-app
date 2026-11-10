import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliverLifecycleReminders, lifecycleReminderOffsets } from './lifecycle-reminders';

test('lifecycle reminders default to 30, 7 and 0 days and only fire on matching UTC day', () => {
  const due = new Date('2026-12-01T00:00:00.000Z');
  assert.deepEqual(lifecycleReminderOffsets(due, undefined, new Date('2026-11-01T17:00:00.000Z')), [30]);
  assert.deepEqual(lifecycleReminderOffsets(due, undefined, new Date('2026-11-24T00:00:00.000Z')), [7]);
  assert.deepEqual(lifecycleReminderOffsets(due, undefined, new Date('2026-12-01T22:00:00.000Z')), [0]);
  assert.deepEqual(lifecycleReminderOffsets(due, undefined, new Date('2026-11-23T00:00:00.000Z')), []);
});

test('lifecycle reminders honor custom offsets and ignore malformed values', () => {
  const due = new Date('2026-12-01T00:00:00.000Z');
  assert.deepEqual(lifecycleReminderOffsets(due, [14, 1, 14, '7', -2], new Date('2026-11-17T00:00:00.000Z')), [14]);
});

test('reminder delivery creates one in-app notification and deduplicates worker retries', async () => {
  let deliveries = 0;
  let notifications = 0;
  const prisma = {
    lifecycleDate: { findMany: async () => [{ id: 'date-1', kind: 'SUPPORT', dueDate: new Date('2026-12-01T00:00:00.000Z'), reminderDays: [0], responsibleUserId: 'user-1', responsibleGroup: null, device: { id: 'device-1', name: 'Router 1' } }] },
    $transaction: async (callback: (tx: any) => Promise<boolean>) => callback({
      lifecycleReminderDelivery: { createMany: async () => { if (deliveries) return { count: 0 }; deliveries++; return { count: 1 }; } },
      notification: { create: async () => { notifications++; return {}; } },
    }),
  };
  const now = new Date('2026-12-01T12:00:00.000Z');
  assert.deepEqual(await deliverLifecycleReminders(prisma as never, now), { examined: 1, delivered: 1 });
  assert.deepEqual(await deliverLifecycleReminders(prisma as never, now), { examined: 1, delivered: 0 });
  assert.equal(notifications, 1);
});
