import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { decryptCredential, encryptCredential, loadKeyring } from '@simoes/snmp-core';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { UpsertNetAppIntegrationDto } from './dto';
import { OntapClient } from './ontap-client';

@Injectable()
export class NetAppService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService) {}

  private keyring() {
    try { return loadKeyring(); }
    catch { throw new ConflictException({ code: 'NETAPP_KEYRING_UNAVAILABLE', message: 'O cofre de credenciais não está configurado.' }); }
  }

  private validateEndpoint(value: string) {
    let endpoint: URL;
    try { endpoint = new URL(value); } catch { throw new BadRequestException({ code: 'NETAPP_ENDPOINT_INVALID', message: 'O endereço ONTAP tem de ser HTTPS válido.' }); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
      throw new BadRequestException({ code: 'NETAPP_ENDPOINT_INVALID', message: 'Indica apenas a origem HTTPS do ONTAP, sem credenciais, caminho ou parâmetros.' });
    }
    return endpoint.origin;
  }

  private public(integration: any) {
    return { id: integration.id, siteId: integration.siteId, endpointUrl: integration.endpointUrl, username: integration.username, configured: true, snapshot: integration.snapshot, lastAttemptAt: integration.lastAttemptAt, lastSuccessAt: integration.lastSuccessAt, lastErrorCode: integration.lastErrorCode, updatedAt: integration.updatedAt };
  }

  async configure(siteId: string, dto: UpsertNetAppIntegrationDto, user: AuthenticatedUser) {
    const endpointUrl = this.validateEndpoint(dto.endpointUrl);
    if (dto.username.includes(':')) throw new BadRequestException({ code: 'NETAPP_USERNAME_INVALID', message: 'O username ONTAP não pode conter dois pontos.' });
    await this.access.assertSite(user, 'UPDATE', siteId);
    const secret = encryptCredential({ password: dto.password }, this.keyring());
    const integration = await this.prisma.netAppIntegration.upsert({
      where: { siteId },
      create: { siteId, endpointUrl, username: dto.username, ...secret },
      update: { endpointUrl, username: dto.username, ...secret },
    });
    await this.audit.record({ userId: user.id, action: 'NETAPP_INTEGRATION_CONFIGURED', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId, endpointUrl, username: dto.username } });
    return this.public(integration);
  }

  async get(siteId: string, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'READ', siteId);
    const integration = await this.prisma.netAppIntegration.findUnique({ where: { siteId } });
    if (!integration) throw new NotFoundException({ code: 'NETAPP_INTEGRATION_NOT_CONFIGURED', message: 'A integração NetApp não está configurada neste site.' });
    await this.audit.record({ userId: user.id, action: 'NETAPP_SNAPSHOT_READ', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId } });
    return this.public(integration);
  }

  async refresh(siteId: string, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'READ', siteId);
    const integration = await this.prisma.netAppIntegration.findUnique({ where: { siteId } });
    if (!integration) throw new NotFoundException({ code: 'NETAPP_INTEGRATION_NOT_CONFIGURED', message: 'A integração NetApp não está configurada neste site.' });
    let password: string;
    try { password = decryptCredential(integration as any, this.keyring()).password; }
    catch { throw new ConflictException({ code: 'NETAPP_CREDENTIAL_UNAVAILABLE', message: 'Não foi possível abrir a credencial armazenada.' }); }
    try {
      const snapshot = await new OntapClient(integration.endpointUrl, integration.username, password).snapshot();
      const updated = await this.prisma.netAppIntegration.update({ where: { id: integration.id }, data: { snapshot, lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null } });
      await this.audit.record({ userId: user.id, action: 'NETAPP_REFRESH_SUCCEEDED', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId, systems: snapshot.systems.length, nodes: snapshot.nodes.length, aggregates: snapshot.aggregates.length, volumes: snapshot.volumes.length } });
      return this.public(updated);
    } catch (error) {
      const knownCode = error instanceof Error && /^ONTAP_(?:HTTP_\d+|TIMEOUT|REDIRECT_BLOCKED|PAGINATION_LIMIT|PAGINATION_ORIGIN_INVALID)$/.test(error.message) ? error.message : 'ONTAP_UNAVAILABLE';
      const updated = await this.prisma.netAppIntegration.update({ where: { id: integration.id }, data: { lastAttemptAt: new Date(), lastErrorCode: knownCode } });
      await this.audit.record({ userId: user.id, action: 'NETAPP_REFRESH_FAILED', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId, errorCode: knownCode, retainedLastKnownSnapshot: Boolean(updated.snapshot) } });
      throw new ServiceUnavailableException({ code: knownCode, message: 'A consulta ao ONTAP falhou. Os últimos dados conhecidos foram mantidos.', lastSuccessAt: updated.lastSuccessAt });
    }
  }
}
