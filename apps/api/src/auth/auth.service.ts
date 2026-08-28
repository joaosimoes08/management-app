import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { ApplicationRole, isApplicationRole } from './roles';

export interface AuthenticatedUser {
  id: string;
  externalId: string;
  username: string;
  roles: ApplicationRole[];
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async syncUser(input: {
    externalId: string;
    username: string;
    displayName?: string;
    email?: string;
    roles: string[];
    ipAddress?: string;
  }): Promise<AuthenticatedUser> {
    // Keycloak can expose the same role through multiple mappings. Keep the
    // persisted role set unique because UserRole uses (userId, role) as its key.
    const roles = [...new Set(input.roles.filter(isApplicationRole))];
    const userByExternalId = await this.prisma.user.findUnique({ where: { externalId: input.externalId } });
    const userByUsername = userByExternalId
      ? null
      : await this.prisma.user.findUnique({ where: { username: input.username } });
    const user = userByExternalId
      ? await this.prisma.user.update({
          where: { id: userByExternalId.id },
          data: { username: input.username, displayName: input.displayName, email: input.email },
        })
      : userByUsername
        ? await this.prisma.user.update({
            where: { id: userByUsername.id },
            data: { externalId: input.externalId, displayName: input.displayName, email: input.email },
          })
        : await this.prisma.user.upsert({
            where: { externalId: input.externalId },
            create: {
              externalId: input.externalId,
              username: input.username,
              displayName: input.displayName,
              email: input.email,
            },
            update: {
              username: input.username,
              displayName: input.displayName,
              email: input.email,
            },
          });

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId: user.id,
          ...(roles.length ? { role: { notIn: roles } } : {}),
        },
      });
      if (roles.length) {
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: user.id, role })),
          skipDuplicates: true,
        });
      }
    });

    await this.audit.record({ userId: user.id, action: 'AUTHENTICATED', entityType: 'User', entityId: user.id, ipAddress: input.ipAddress });
    return { id: user.id, externalId: user.externalId, username: user.username, roles };
  }
}
