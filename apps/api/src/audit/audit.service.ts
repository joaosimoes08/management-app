import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}
  list(limit = 50) { return this.prisma.auditLog.findMany({ take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, displayName: true } } } }); }
  record(input: { userId?: string; action: string; entityType?: string; entityId?: string; metadata?: unknown; ipAddress?: string }) {
    return this.prisma.auditLog.create({ data: { ...input, metadata: input.metadata as object | undefined } });
  }
}
