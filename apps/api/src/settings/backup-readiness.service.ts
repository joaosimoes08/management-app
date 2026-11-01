import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';

const CHECKS = ['BACKUP_COMPLETED', 'RESTORE_VERIFIED', 'RESTORE_FAILED'];

@Injectable()
export class BackupReadinessService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async status() {
    const events = await this.prisma.auditLog.findMany({ where: { entityType: 'BACKUP_READINESS', action: { in: CHECKS } }, orderBy: { createdAt: 'desc' }, take: 100, select: { action: true, createdAt: true, metadata: true, user: { select: { username: true, displayName: true } } } });
    const backup = events.find((event) => event.action === 'BACKUP_COMPLETED');
    const verification = events.find((event) => event.action === 'RESTORE_VERIFIED' || event.action === 'RESTORE_FAILED');
    return { mechanism: 'operator-recorded', integration: 'No deployment backup job is configured by the application. Docker volumes are persistent; they are not backups.', latestBackup: backup ? { recordedAt: backup.createdAt, ...backup.metadata as object, recordedBy: backup.user?.displayName || backup.user?.username } : null, latestRestoreVerification: verification ? { outcome: verification.action === 'RESTORE_VERIFIED' ? 'VERIFIED' : 'FAILED', recordedAt: verification.createdAt, ...verification.metadata as object, recordedBy: verification.user?.displayName || verification.user?.username } : null, restoreVerified: verification?.action === 'RESTORE_VERIFIED' };
  }

  async record(input: { kind: string; completedAt: string; reference?: string; notes?: string }, user: AuthenticatedUser) {
    await this.audit.record({ userId: user.id, action: input.kind, entityType: 'BACKUP_READINESS', metadata: { completedAt: input.completedAt, reference: input.reference, notes: input.notes } });
    return this.status();
  }
}
