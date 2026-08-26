import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runAuditRetentionCleanup } from './audit-retention';

test('audit cleanup deletes only events older than the retention boundary and records a summary', async () => {
  const now = new Date('2026-08-24T12:00:00.000Z'); const boundary = new Date('2026-05-26T12:00:00.000Z');
  const events = [{ id: 'old', createdAt: new Date('2026-05-26T11:59:59.999Z') }, { id: 'boundary', createdAt: boundary }, { id: 'new', createdAt: new Date('2026-08-01T00:00:00.000Z') }];
  let cleanupMetadata: any; let settingsUpdate: any;
  const prisma = {
    systemSettings: { findFirst: async () => ({ id: 'settings', auditRetentionDays: 90 }), update: async (args: any) => { settingsUpdate = args.data; } },
    auditLog: {
      findMany: async (args: any) => events.filter((entry) => entry.createdAt < args.where.createdAt.lt).map(({ id }) => ({ id })),
      deleteMany: async (args: any) => { const ids = args.where.id.in; return { count: ids.length }; },
      create: async (args: any) => { cleanupMetadata = args.data.metadata; },
    },
  };
  const result = await runAuditRetentionCleanup(prisma as never, now);
  assert.equal(result.deleted, 1); assert.equal(result.cutoff.toISOString(), boundary.toISOString()); assert.equal(settingsUpdate.lastAuditCleanupDeletedCount, 1); assert.deepEqual(cleanupMetadata, { deleted: 1, retentionDays: 90, cutoff: boundary.toISOString() });
});
