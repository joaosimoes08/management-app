import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { ApplicationRole } from '../auth/roles';
import { AuthenticatedUser } from '../auth/auth.service';
import { KeycloakAdminService } from './keycloak-admin.service';

export const SELF_REQUEST_ROLES = ['NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR'] as const;
export type SelfRequestRole = (typeof SELF_REQUEST_ROLES)[number];

@Injectable()
export class RoleRequestService {
  constructor(private readonly prisma: PrismaClient, private readonly keycloak: KeycloakAdminService, private readonly audit: AuditService) {}

  async mine(user: AuthenticatedUser) {
    const [pendingRequest, history] = await Promise.all([
      this.prisma.roleRequest.findFirst({ where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.roleRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return { eligibleRoles: [...SELF_REQUEST_ROLES], currentRoles: user.roles, pendingRequest: pendingRequest ? this.present(pendingRequest) : null, history: history.map((item) => this.present(item)) };
  }

  private present(item: { id: string; roles: unknown; status: string; createdAt: Date; processingAt?: Date | null; decidedAt?: Date | null }) {
    return { id: item.id, requestedRoles: Array.isArray(item.roles) ? item.roles : [], status: item.status, createdAt: item.createdAt, processingAt: item.processingAt ?? null, decidedAt: item.decidedAt ?? null };
  }

  async submit(user: AuthenticatedUser, input: SelfRequestRole[]) {
    const roles = [...new Set(input)] as SelfRequestRole[];
    if (!roles.length || roles.some((role) => !(SELF_REQUEST_ROLES as readonly string[]).includes(role))) throw new BadRequestException({ code: 'ROLE_REQUEST_INVALID', message: 'A seleção de roles não é válida.' });
    const effectiveRoles = await this.keycloak.effectiveRoles(user.externalId);
    const held = roles.filter((role) => effectiveRoles.includes(role as ApplicationRole));
    if (held.length) throw new ConflictException({ code: 'ROLE_ALREADY_HELD', message: 'O utilizador já possui uma ou mais roles pedidas.' });
    const existing = await this.prisma.roleRequest.findFirst({ where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } } });
    if (existing) throw new ConflictException({ code: 'ROLE_REQUEST_PENDING', message: 'Já existe um pedido de roles pendente.' });
    try {
      const request = await this.prisma.roleRequest.create({ data: { userId: user.id, roles } });
      await this.audit.record({ userId: user.id, action: 'ROLE_REQUEST_SUBMITTED', entityType: 'RoleRequest', entityId: request.id, metadata: { roles } });
      return this.present(request);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'ROLE_REQUEST_PENDING', message: 'Já existe um pedido de roles pendente.' });
      throw error;
    }
  }

  async decide(id: string, decision: 'APPROVE' | 'REJECT', reviewer: AuthenticatedUser) {
    const claimed = await this.prisma.roleRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PROCESSING', reviewerId: reviewer.id, processingAt: new Date() } });
    const request = await this.prisma.roleRequest.findUnique({ where: { id }, include: { user: true } });
    if (!request) throw new NotFoundException('Pedido não encontrado.');
    const reconcilingApproval = decision === 'APPROVE' && request.status === 'PROCESSING';
    if (!claimed.count && !reconcilingApproval) throw new ConflictException({ code: 'ROLE_REQUEST_NOT_PENDING', message: 'O pedido já foi processado.' });
    const roles = (Array.isArray(request.roles) ? request.roles : []) as SelfRequestRole[];
    if (decision === 'REJECT') {
      const finalized = await this.finalize(request.id, 'REJECTED', request.userId, reviewer.id, 'Pedido de roles rejeitado', `O teu pedido de roles foi rejeitado por ${reviewer.username}.`);
      await this.audit.record({ userId: reviewer.id, action: 'ROLE_REQUEST_REJECTED', entityType: 'RoleRequest', entityId: id, metadata: { roles } });
      return this.present(finalized);
    }
    await this.keycloak.grantRoles(request.user.externalId, roles as ApplicationRole[]);
    const finalized = await this.finalize(request.id, 'APPROVED', request.userId, reviewer.id, 'Pedido de roles aprovado', `O teu pedido de roles foi aprovado por ${reviewer.username}. Faz logout e login novamente para atualizar a sessão.`);
    await this.audit.record({ userId: reviewer.id, action: 'ROLE_REQUEST_APPROVED', entityType: 'RoleRequest', entityId: id, metadata: { roles } });
    return this.present(finalized);
  }

  private async finalize(id: string, status: 'APPROVED' | 'REJECTED', userId: string, reviewerId: string, title: string, message: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.roleRequest.updateMany({ where: { id, status: 'PROCESSING' }, data: { status, reviewerId, decidedAt: new Date() } });
      if (!result.count) throw new ConflictException({ code: 'ROLE_REQUEST_NOT_PENDING', message: 'O pedido já foi processado.' });
      await tx.notification.create({ data: { userId, roleRequestId: id, type: `ROLE_REQUEST_${status}`, title, message } });
      return tx.roleRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}
