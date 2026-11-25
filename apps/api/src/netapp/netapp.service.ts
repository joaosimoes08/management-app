import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { NetAppSampleKind, Prisma, PrismaClient } from '@simoes/database';
import { decryptCredential, encryptCredential, loadKeyring } from '@simoes/snmp-core';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { UpsertNetAppIntegrationDto } from './dto';
import { OntapClient } from './ontap-client';
import { buildTrend, capacitySamples, CLUSTER_OBJECT_KEY, DailySample, historyRetentionDays, NETAPP_SAMPLE_KINDS } from './netapp-history';

const DAY = 86_400_000;
const TREND_DEFAULT_DAYS = 90;
const TREND_OBJECT_LIMIT = 1000;

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
    // A site without an integration is a normal state, not an error: 200 with an explicit body (no audit, nothing was read).
    if (!integration) return { siteId, configured: false as const };
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
      // The current snapshot is still overwritten as before; each success also appends history rows and prunes past retention.
      const [updated] = await this.prisma.$transaction([
        this.prisma.netAppIntegration.update({ where: { id: integration.id }, data: { snapshot, lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null } }),
        this.prisma.netAppCapacitySample.createMany({ data: capacitySamples(integration.id, snapshot) }),
        this.prisma.netAppCapacitySample.deleteMany({ where: { integrationId: integration.id, observedAt: { lt: new Date(Date.now() - historyRetentionDays() * DAY) } } }),
      ]);
      await this.audit.record({ userId: user.id, action: 'NETAPP_REFRESH_SUCCEEDED', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId, systems: snapshot.systems.length, nodes: snapshot.nodes.length, aggregates: snapshot.aggregates.length, volumes: snapshot.volumes.length } });
      return this.public(updated);
    } catch (error) {
      const knownCode = error instanceof Error && /^ONTAP_(?:HTTP_\d+|TIMEOUT|REDIRECT_BLOCKED|PAGINATION_LIMIT|PAGINATION_ORIGIN_INVALID)$/.test(error.message) ? error.message : 'ONTAP_UNAVAILABLE';
      const updated = await this.prisma.netAppIntegration.update({ where: { id: integration.id }, data: { lastAttemptAt: new Date(), lastErrorCode: knownCode } });
      await this.audit.record({ userId: user.id, action: 'NETAPP_REFRESH_FAILED', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId, errorCode: knownCode, retainedLastKnownSnapshot: Boolean(updated.snapshot) } });
      throw new ServiceUnavailableException({ code: knownCode, message: 'A consulta ao ONTAP falhou. Os últimos dados conhecidos foram mantidos.', lastSuccessAt: updated.lastSuccessAt });
    }
  }

  private trendParams(kind: string | undefined, days: string | undefined) {
    const value = (kind ?? 'CLUSTER').toUpperCase();
    if (!(NETAPP_SAMPLE_KINDS as readonly string[]).includes(value)) throw new BadRequestException({ code: 'NETAPP_TREND_INVALID', message: `kind tem de ser ${NETAPP_SAMPLE_KINDS.join(', ')}.` });
    const retention = historyRetentionDays();
    const parsed = days === undefined || days === '' ? TREND_DEFAULT_DAYS : Number(days);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > retention) throw new BadRequestException({ code: 'NETAPP_TREND_INVALID', message: `days tem de ser um inteiro entre 1 e ${retention}.` });
    return { kind: value as NetAppSampleKind, days: parsed, since: new Date(Date.now() - parsed * DAY), retentionDays: retention };
  }
  private async integrationFor(siteId: string, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'READ', siteId);
    const integration = await this.prisma.netAppIntegration.findUnique({ where: { siteId }, select: { id: true } });
    if (!integration) throw new NotFoundException({ code: 'NETAPP_INTEGRATION_NOT_CONFIGURED', message: 'A integração NetApp não está configurada neste site.' });
    return integration;
  }

  /** Daily capacity trend (last reading of each UTC day) for the cluster total, one aggregate or one volume. */
  async trend(siteId: string, user: AuthenticatedUser, query: { kind?: string; key?: string; days?: string }) {
    const params = this.trendParams(query.kind, query.days);
    const key = params.kind === 'CLUSTER' ? CLUSTER_OBJECT_KEY : query.key?.trim();
    if (!key || key.length > 255) throw new BadRequestException({ code: 'NETAPP_TREND_INVALID', message: 'Indica key (uuid ou nome do aggregate/volume).' });
    const integration = await this.integrationFor(siteId, user);
    const rows = await this.prisma.$queryRaw<DailySample[]>(Prisma.sql`
      SELECT DISTINCT ON (date_trunc('day', "observedAt")) date_trunc('day', "observedAt") AS "day", "observedAt", "name", "svm", "state", "sizeBytes", "usedBytes"
      FROM "NetAppCapacitySample"
      WHERE "integrationId" = ${integration.id}::uuid AND "kind" = ${params.kind}::"NetAppSampleKind" AND "objectKey" = ${key} AND "observedAt" >= ${params.since}
      ORDER BY date_trunc('day', "observedAt") ASC, "observedAt" DESC`);
    await this.audit.record({ userId: user.id, action: 'NETAPP_TREND_READ', entityType: 'NetAppIntegration', entityId: integration.id, metadata: { siteId, kind: params.kind, key, days: params.days } });
    const latest = rows[rows.length - 1];
    return { siteId, kind: params.kind, key, name: latest?.name ?? null, svm: latest?.svm ?? null, days: params.days, retentionDays: params.retentionDays, ...buildTrend(rows) };
  }

  /** Every aggregate or volume seen in the window, with its latest reading and the change since its first reading in the window. */
  async trendObjects(siteId: string, user: AuthenticatedUser, query: { kind?: string; days?: string }) {
    const params = this.trendParams(query.kind ?? 'VOLUME', query.days);
    const integration = await this.integrationFor(siteId, user);
    type Row = { objectKey: string; name: string; svm: string | null; state: string | null; observedAt: Date; sizeBytes: bigint | null; usedBytes: bigint | null; firstObservedAt: Date; firstUsedBytes: bigint | null };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON ("objectKey") "objectKey", "name", "svm", "state", "observedAt", "sizeBytes", "usedBytes"
        FROM "NetAppCapacitySample"
        WHERE "integrationId" = ${integration.id}::uuid AND "kind" = ${params.kind}::"NetAppSampleKind" AND "observedAt" >= ${params.since}
        ORDER BY "objectKey", "observedAt" DESC
      ), earliest AS (
        SELECT DISTINCT ON ("objectKey") "objectKey", "observedAt" AS "firstObservedAt", "usedBytes" AS "firstUsedBytes"
        FROM "NetAppCapacitySample"
        WHERE "integrationId" = ${integration.id}::uuid AND "kind" = ${params.kind}::"NetAppSampleKind" AND "observedAt" >= ${params.since}
        ORDER BY "objectKey", "observedAt" ASC
      )
      SELECT l.*, e."firstObservedAt", e."firstUsedBytes" FROM latest l JOIN earliest e USING ("objectKey")
      ORDER BY l."name" ASC, l."objectKey" ASC
      LIMIT ${TREND_OBJECT_LIMIT + 1}`);
    const n = (value: bigint | null) => value === null ? null : Number(value);
    return {
      siteId, kind: params.kind, days: params.days, retentionDays: params.retentionDays,
      items: rows.slice(0, TREND_OBJECT_LIMIT).map((row) => {
        const sizeBytes = n(row.sizeBytes); const usedBytes = n(row.usedBytes); const firstUsedBytes = n(row.firstUsedBytes);
        const spanDays = (row.observedAt.getTime() - row.firstObservedAt.getTime()) / DAY;
        const changeBytes = usedBytes !== null && firstUsedBytes !== null ? usedBytes - firstUsedBytes : null;
        return { key: row.objectKey, name: row.name, svm: row.svm, state: row.state, observedAt: row.observedAt.toISOString(), sizeBytes, usedBytes, usedPercent: usedBytes !== null && sizeBytes ? Math.round((usedBytes / sizeBytes) * 10_000) / 100 : null, firstObservedAt: row.firstObservedAt.toISOString(), changeBytes, growthBytesPerDay: changeBytes !== null && spanDays >= 1 ? Math.round(changeBytes / spanDays) : null };
      }),
      truncated: rows.length > TREND_OBJECT_LIMIT,
    };
  }
}
