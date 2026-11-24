import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { ApplicationRole, isApplicationRole } from './roles';

/** Prisma P2002: unique constraint failed. */
const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

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
    const persistedRoles = [...roles, ...(input.roles.includes('STORAGE_OPERATOR') ? ['STORAGE_OPERATOR' as const] : [])];
    // Two first-load requests (e.g. parallel POST /auth/me) can both miss the user and race on create;
    // the loser gets P2002 on username/externalId. Re-read once: the row now exists, so the update path wins.
    let user: Awaited<ReturnType<AuthService['resolveUser']>>;
    try {
      user = await this.resolveUser(input);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      user = await this.resolveUser(input);
    }

    // Every authenticated request lands here. Skip the role rewrite when the stored set already matches
    // (unknown stored roles, e.g. a freshly created user, still take the write path).
    const storedRoles = user.roles?.map((entry) => entry.role);
    const rolesUnchanged = storedRoles !== undefined && storedRoles.length === new Set(persistedRoles).size && new Set(persistedRoles).size === new Set([...storedRoles, ...persistedRoles]).size;
    if (!rolesUnchanged) await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId: user.id,
          ...(persistedRoles.length ? { role: { notIn: persistedRoles } } : {}),
        },
      });
      if (persistedRoles.length) {
        await tx.userRole.createMany({
          data: persistedRoles.map((role) => ({ userId: user.id, role })),
          skipDuplicates: true,
        });
      }
    });

    await this.audit.record({ userId: user.id, action: 'AUTHENTICATED', entityType: 'User', entityId: user.id, ipAddress: input.ipAddress });
    return { id: user.id, externalId: user.externalId, username: user.username, roles };
  }

  private async resolveUser(input: { externalId: string; username: string; displayName?: string; email?: string }): Promise<{ id: string; externalId: string; username: string; roles?: Array<{ role: string }> }> {
    const userByExternalId = await this.prisma.user.findUnique({ where: { externalId: input.externalId }, include: { roles: { select: { role: true } } } });
    // Same values as last time: no UPDATE (Prisma leaves undefined fields alone, so undefined counts as unchanged).
    if (userByExternalId && userByExternalId.username === input.username
      && (input.displayName === undefined || input.displayName === userByExternalId.displayName)
      && (input.email === undefined || input.email === userByExternalId.email)) return userByExternalId;
    const userByUsername = userByExternalId
      ? null
      : await this.prisma.user.findUnique({ where: { username: input.username } });
    return userByExternalId
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
  }
}
