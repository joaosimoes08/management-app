import { PrismaClient } from '@simoes/database';

export async function runAuditRetentionCleanup(prisma: PrismaClient, now = new Date()) {
  const settings = (await prisma.systemSettings.findFirst()) ?? await prisma.systemSettings.create({ data: {} });
  const cutoff = new Date(now.getTime() - settings.auditRetentionDays * 24 * 60 * 60 * 1000);
  let deleted = 0;
  while (true) {
    const batch = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: 1000, orderBy: { createdAt: 'asc' } });
    if (!batch.length) break;
    const result = await prisma.auditLog.deleteMany({ where: { id: { in: batch.map((entry) => entry.id) } } }); deleted += result.count;
    if (batch.length < 1000) break;
  }
  await prisma.systemSettings.update({ where: { id: settings.id }, data: { lastAuditCleanupAt: now, lastAuditCleanupDeletedCount: deleted } });
  await prisma.auditLog.create({ data: { action: 'AUDIT_RETENTION_CLEANUP', entityType: 'SystemSettings', entityId: settings.id, metadata: { deleted, retentionDays: settings.auditRetentionDays, cutoff: cutoff.toISOString() } } });
  return { deleted, cutoff };
}
