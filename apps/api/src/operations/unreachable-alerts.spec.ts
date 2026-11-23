import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AlertSeverityDto } from './dto';
import { DEFAULT_UNREACHABLE_AFTER_FAILURES, unreachableAlerts, unreachableThreshold } from './operations-reconciler.service';
import { OperationsService } from './operations.service';

// SNMP Phase 1 step 1: one HIGH alert per device after N consecutive failed polls; it resolves on the next success.
const config = (deviceId: string, consecutiveFailures: number) => ({ deviceId, consecutiveFailures, lastPollAt: new Date('2026-11-23T10:00:00Z'), lastErrorCode: 'SNMP_TIMEOUT', device: { siteId: 'site-1', name: deviceId } });

/** In-memory OperationalAlert store with the subset of Prisma calls reconcileSource uses. */
function memoryAlerts(initial: any[] = []) {
  const rows = new Map<string, any>(initial.map((row) => [row.dedupKey, { ...row }]));
  let seq = 0;
  const matches = (row: any, where: any) => (!where.source || row.source === where.source)
    && (!where.status?.not || row.status !== where.status.not)
    && (!where.dedupKey?.notIn || !where.dedupKey.notIn.includes(row.dedupKey))
    && (!where.dedupKey?.in || where.dedupKey.in.includes(row.dedupKey));
  const prisma = {
    operationalAlert: {
      findUnique: async ({ where }: any) => rows.get(where.dedupKey) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = rows.get(where.dedupKey);
        const next = existing
          ? { ...existing, ...update, occurrenceCount: typeof update.occurrenceCount === 'number' ? update.occurrenceCount : existing.occurrenceCount + 1 }
          : { id: `alert-${++seq}`, occurrenceCount: 1, ...create };
        rows.set(where.dedupKey, next);
        return next;
      },
      update: async ({ where, data }: any) => { const row = [...rows.values()].find((item) => item.id === where.id); Object.assign(row, data); return row; },
      findMany: async ({ where }: any) => [...rows.values()].filter((row) => matches(row, where)).map((row) => ({ id: row.id, siteId: row.siteId })),
      updateMany: async ({ where, data }: any) => { let count = 0; for (const row of rows.values()) if (where.id.in.includes(row.id)) { Object.assign(row, data); count += 1; } return { count }; },
    },
    operationalAlertUserState: { updateMany: async () => ({ count: 0 }) },
  };
  return { prisma, rows };
}

test('threshold defaults to 3 and accepts a sane override', () => {
  assert.equal(DEFAULT_UNREACHABLE_AFTER_FAILURES, 3);
  assert.equal(unreachableThreshold(undefined), 3);
  assert.equal(unreachableThreshold('5'), 5);
  assert.equal(unreachableThreshold('0'), 3);
  assert.equal(unreachableThreshold('abc'), 3);
});

test('one HIGH device alert, not one per failed job', () => {
  const alerts = unreachableAlerts([config('sw-1', 3), config('sw-2', 7)]);
  assert.deepEqual(alerts.map((alert) => alert.dedupKey), ['snmp:unreachable:sw-1', 'snmp:unreachable:sw-2']);
  assert.ok(alerts.every((alert) => alert.severity === AlertSeverityDto.HIGH && alert.source === 'SNMP_POLL' && alert.entityType === 'Device'));
  assert.match(alerts[1].detail, /7 polls seguidos falharam \(SNMP_TIMEOUT\)/);
});

test('opens once while polls keep failing, auto-resolves on success and retires legacy per-job alerts', async () => {
  const { prisma, rows } = memoryAlerts([{ id: 'legacy', dedupKey: 'snmp:failed:job-1', source: 'SNMP_POLL', status: 'OPEN', siteId: 'site-1', occurrenceCount: 1 }]);
  const opened: any[] = [];
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never, { alertOpened: (alert: any) => opened.push(alert) } as never);
  (service as any).publish = async () => undefined;
  const threshold = unreachableThreshold(undefined);
  const pass = (failures: number) => service.reconcileSource('SNMP_POLL', unreachableAlerts(failures >= threshold ? [config('sw-1', failures)] : []));

  await pass(1); await pass(2);
  assert.equal(rows.has('snmp:unreachable:sw-1'), false, 'below N: no alert');
  assert.equal(rows.get('snmp:failed:job-1').status, 'RESOLVED', 'legacy per-job alert resolves on the first pass');
  await pass(3); await pass(4); await pass(5);
  assert.equal(rows.get('snmp:unreachable:sw-1').status, 'OPEN');
  assert.equal(opened.length, 1, 'delivered once, not per failed poll');
  await pass(0);
  assert.equal(rows.get('snmp:unreachable:sw-1').status, 'RESOLVED', 'a successful poll resets the counter and resolves');
});
