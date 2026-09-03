import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import * as net from 'node:net';
import { PrismaClient, SnmpCredentialPurpose, SnmpVersion } from '@simoes/database';
import { decryptCredential, encryptCredential, loadKeyring, rewrapCredential, SNMP_JOB_NAMES, SNMP_QUEUE, snmpPayload, validateSetTemplate } from '@simoes/snmp-core';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { AcceptSnmpEnrollmentDto, CreateSnmpCredentialDto, CreateSnmpTrapEnrollmentDto, CreateSnmpWritePreviewDto, ReviewSnmpDriftDto, SnmpCredentialSecretDto, SnmpOnboardingDeviceDto, UpsertSnmpConfigDto } from './dto';

@Injectable()
export class SnmpService implements OnModuleDestroy, OnModuleInit {
  private readonly queue = new Queue(SNMP_QUEUE, { connection: this.redisConnection() });

  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService) {}
  onModuleInit() { void this.reconcileSchedulers(); }
  async onModuleDestroy() { await this.queue.disconnect(); }
  private redisConnection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), ...(url.password ? { password: url.password } : {}) }; }
  private keyring() { try { return loadKeyring(); } catch { throw new ConflictException({ code: 'SNMP_KEYRING_UNAVAILABLE', message: 'O cofre SNMP não está configurado.' }); } }
  private async log(user: AuthenticatedUser | undefined, action: string, entityType: string, entityId: string, metadata?: unknown) { await this.audit.record({ userId: user?.id, action, entityType, entityId, metadata }); }
  private async reloadTrapCredentials(recordId: string) { await this.queue.add(SNMP_JOB_NAMES.reloadCredentials, snmpPayload(recordId), { removeOnComplete: 20, removeOnFail: 20 }).catch(() => undefined); }

  private async scheduleConfig(item: { id: string; deviceId: string; enabled: boolean; intervalMinutes: number }) {
    const schedulerId = `snmp-device-${item.deviceId}`;
    if (!item.enabled) {
      await this.queue.removeJobScheduler(schedulerId);
      await this.prisma.snmpDeviceConfig.update({ where: { id: item.id }, data: { nextPollAt: null } });
      return;
    }
    const every = item.intervalMinutes * 60 * 1000;
    const jitter = this.deterministicJitter(item.deviceId, Math.min(every / 4, 60_000));
    await this.queue.upsertJobScheduler(schedulerId, { every, startDate: new Date(Date.now() + jitter) }, { name: SNMP_JOB_NAMES.poll, data: snmpPayload(item.id), opts: { removeOnComplete: 100, removeOnFail: 100 } });
    await this.prisma.snmpDeviceConfig.update({ where: { id: item.id }, data: { nextPollAt: new Date(Date.now() + jitter), lastErrorCode: null } });
  }

  private async reconcileSchedulers() {
    const configs = await this.prisma.snmpDeviceConfig.findMany({ where: { enabled: true }, select: { id: true, deviceId: true, enabled: true, intervalMinutes: true } }).catch(() => []);
    for (const config of configs) await this.scheduleConfig(config).catch(() => this.prisma.snmpDeviceConfig.update({ where: { id: config.id }, data: { nextPollAt: null, lastErrorCode: 'SNMP_QUEUE_UNAVAILABLE' } }).catch(() => undefined));
  }

  private publicCredential(item: any) {
    return { id: item.id, deviceId: item.deviceId, purpose: item.purpose, version: item.version, label: item.label, username: item.username, authProtocol: item.authProtocol, privProtocol: item.privProtocol, enabled: item.enabled, configured: true, lastTestedAt: item.lastTestedAt, lastTestStatus: item.lastTestStatus, lastUsedAt: item.lastUsedAt, keyId: item.keyId, createdAt: item.createdAt, updatedAt: item.updatedAt };
  }

  private async device(deviceId: string, user: AuthenticatedUser, action: 'READ' | 'UPDATE' = 'READ') {
    await this.access.assertDevice(user, action, deviceId);
    const device = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true, type: true, managementIp: true, siteId: true } });
    if (!device) throw new NotFoundException('Equipamento não encontrado');
    if (!['SWITCH', 'ROUTER', 'FIREWALL'].includes(device.type)) throw new BadRequestException({ code: 'SNMP_DEVICE_TYPE_UNSUPPORTED', message: 'SNMP só pode ser configurado em equipamentos de rede.' });
    return device;
  }

  async unmatchedTraps() {
    return this.prisma.snmpTrapEvent.findMany({
      where: { status: 'UNMATCHED' },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
  }

  async overview(deviceId: string, user: AuthenticatedUser) {
    await this.device(deviceId, user);
    const [config, credentials, latestSnapshot, jobs, drifts, traps] = await Promise.all([
      this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId } }),
      this.prisma.snmpCredential.findMany({ where: { deviceId }, orderBy: { purpose: 'asc' } }),
      this.prisma.snmpSnapshot.findFirst({ where: { deviceId }, include: { interfaces: true }, orderBy: { observedAt: 'desc' } }),
      this.prisma.snmpJob.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.snmpDrift.findMany({ where: { deviceId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.snmpTrapEvent.findMany({ where: { deviceId }, orderBy: { receivedAt: 'desc' }, take: 100 }),
    ]);
    return { config, credentials: credentials.map((item) => this.publicCredential(item)), latestSnapshot, jobs, drifts, traps, setEnabled: process.env.SNMP_SET_ENABLED === 'true' };
  }

  async upsertConfig(deviceId: string, dto: UpsertSnmpConfigDto, user: AuthenticatedUser) {
    const device = await this.device(deviceId, user, 'UPDATE');
    if (!device.managementIp || net.isIP(device.managementIp) === 0) throw new BadRequestException({ code: 'SNMP_MANAGEMENT_IP_REQUIRED', message: 'O equipamento precisa de um IP de gestão válido.' });
    const data = { enabled: dto.enabled, port: dto.port ?? 161, intervalMinutes: dto.intervalMinutes ?? 15, timeoutMs: dto.timeoutMs ?? 5000, retries: dto.retries ?? 2, compatibilitySha1: dto.compatibilitySha1 ?? false };
    const item = await this.prisma.snmpDeviceConfig.upsert({ where: { deviceId }, create: { deviceId, ...data }, update: data });
    await this.scheduleConfig(item);
    await this.log(user, 'SNMP_CONFIG_UPDATED', 'SnmpDeviceConfig', item.id, { deviceId, ...data });
    return this.prisma.snmpDeviceConfig.findUnique({ where: { id: item.id } });
  }

  private deterministicJitter(value: string, max: number) { return [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) % Math.max(1, Math.floor(max)); }
  private purpose(value: string): SnmpCredentialPurpose {
    if (!['READ', 'WRITE', 'TRAP'].includes(value)) throw new BadRequestException({ code: 'SNMP_CREDENTIAL_PURPOSE_INVALID', message: 'Finalidade de credencial inválida.' });
    return value as SnmpCredentialPurpose;
  }

  private credentialSecret(dto: SnmpCredentialSecretDto, config?: { compatibilitySha1: boolean } | null): Record<string, string> {
    if (dto.version === 'V2C') {
      if (!dto.community || dto.community.length < 8) throw new BadRequestException({ code: 'SNMP_COMMUNITY_INVALID', message: 'A comunidade deve ter pelo menos 8 caracteres.' });
      return { community: dto.community };
    }
    if (!dto.username || !dto.authKey || !dto.privKey) throw new BadRequestException({ code: 'SNMP_V3_SECRET_INCOMPLETE', message: 'SNMPv3 exige username, authKey e privKey.' });
    const authProtocol = dto.authProtocol ?? 'SHA256';
    if (authProtocol === 'SHA1' && !config?.compatibilitySha1) throw new BadRequestException({ code: 'SNMP_SHA1_COMPATIBILITY_DISABLED', message: 'Ativa explicitamente a compatibilidade SHA-1 no equipamento.' });
    if (dto.authKey.length < 8 || dto.privKey.length < 8) throw new BadRequestException({ code: 'SNMP_V3_SECRET_WEAK', message: 'As chaves SNMPv3 devem ter pelo menos 8 caracteres.' });
    return { username: dto.username, authKey: dto.authKey, privKey: dto.privKey };
  }

  private credentialMetadata(dto: SnmpCredentialSecretDto) {
    return dto.version === 'V3'
      ? { username: dto.username, authProtocol: dto.authProtocol ?? 'SHA256', privProtocol: dto.privProtocol ?? 'AES128' }
      : { username: null, authProtocol: null, privProtocol: null };
  }

  private async lockCredentialPolicy(tx: any) { await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(830129037)'); }

  private async assertSecretAvailable(secret: Record<string, string>, options: { skipCredentialId?: string; skipEnrollmentId?: string; v3TrapUsername?: string }, db: any = this.prisma) {
    const keyring = this.keyring();
    const credentialRecords = await Promise.all([db.snmpCredential.findMany(), db.snmpTrapEnrollment.findMany()]);
    const credentials = credentialRecords[0] as any[]; const enrollments = credentialRecords[1] as any[];
    if (options.v3TrapUsername) {
      if (credentials.some((item) => item.id !== options.skipCredentialId && item.purpose === 'TRAP' && item.version === 'V3' && item.username === options.v3TrapUsername)
        || enrollments.some((item) => item.id !== options.skipEnrollmentId && item.version === 'V3' && item.username === options.v3TrapUsername)) {
        throw new ConflictException({ code: 'SNMP_TRAP_USERNAME_CONFLICT', message: 'O username SNMPv3 de traps deve ser único.' });
      }
    }
    for (const item of [...credentials.filter((entry) => entry.id !== options.skipCredentialId), ...enrollments.filter((entry) => entry.id !== options.skipEnrollmentId)]) {
      let existing: Record<string, string>;
      try { existing = decryptCredential(item as any, keyring); }
      catch { throw new ConflictException({ code: 'SNMP_EXISTING_CREDENTIAL_UNAVAILABLE', message: 'Não foi possível validar a exclusividade das credenciais existentes.' }); }
      if (JSON.stringify(existing) === JSON.stringify(secret)) throw new ConflictException({ code: 'SNMP_CREDENTIAL_REUSE', message: 'A credencial SNMP já está atribuída a outra finalidade, equipamento ou pré-registo.' });
    }
    return keyring;
  }

  async createCredential(deviceId: string, dto: CreateSnmpCredentialDto, user: AuthenticatedUser) {
    await this.device(deviceId, user, 'UPDATE');
    const purpose = this.purpose(dto.purpose);
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId } });
    const secret = this.credentialSecret(dto, config);
    const metadata = this.credentialMetadata(dto);
    const { item, previous } = await this.prisma.$transaction(async (tx) => {
      await this.lockCredentialPolicy(tx);
      const previous = await tx.snmpCredential.findUnique({ where: { deviceId_purpose: { deviceId, purpose } } });
      const keyring = await this.assertSecretAvailable(secret, { skipCredentialId: previous?.id, v3TrapUsername: dto.purpose === 'TRAP' && dto.version === 'V3' ? dto.username : undefined }, tx);
      const envelope = encryptCredential(secret, keyring);
      const item = await tx.snmpCredential.upsert({ where: { deviceId_purpose: { deviceId, purpose } }, create: { deviceId, purpose, version: dto.version as SnmpVersion, label: dto.label, ...metadata, ...envelope }, update: { version: dto.version as SnmpVersion, label: dto.label, ...metadata, ...envelope, enabled: true, lastTestStatus: null } });
      return { item, previous };
    }, { isolationLevel: 'ReadCommitted' }).catch((error: any) => {
      if (error instanceof ConflictException) throw error;
      if (error?.code === 'P2034') throw new ConflictException({ code: 'SNMP_CREDENTIAL_CONCURRENT_UPDATE', message: 'A credencial concorreu com outra operação. Repete o pedido.' });
      throw error;
    });
    await this.log(user, previous ? 'SNMP_CREDENTIAL_REPLACED' : 'SNMP_CREDENTIAL_CREATED', 'SnmpCredential', item.id, { deviceId, purpose: item.purpose, version: item.version, keyId: item.keyId });
    if (item.purpose === 'TRAP') await this.reloadTrapCredentials(item.id);
    return this.publicCredential(item);
  }

  async deleteCredential(deviceId: string, purpose: SnmpCredentialPurpose, user: AuthenticatedUser) {
    purpose = this.purpose(purpose);
    await this.device(deviceId, user, 'UPDATE');
    const item = await this.prisma.snmpCredential.delete({ where: { deviceId_purpose: { deviceId, purpose } } }).catch(() => { throw new NotFoundException('Credencial SNMP não encontrada'); });
    await this.log(user, 'SNMP_CREDENTIAL_DELETED', 'SnmpCredential', item.id, { deviceId, purpose });
    if (purpose === 'TRAP') await this.reloadTrapCredentials(item.id);
    return { success: true };
  }

  async testCredential(deviceId: string, purpose: SnmpCredentialPurpose, user: AuthenticatedUser) {
    purpose = this.purpose(purpose);
    await this.device(deviceId, user, 'UPDATE');
    const credential = await this.prisma.snmpCredential.findUnique({ where: { deviceId_purpose: { deviceId, purpose } } });
    if (!credential) throw new NotFoundException('Credencial SNMP não encontrada');
    const job = await this.prisma.snmpJob.create({ data: { deviceId, credentialId: credential.id, type: 'CREDENTIAL_TEST', requestedBy: user.id } });
    await this.queue.add(SNMP_JOB_NAMES.credentialTest, snmpPayload(job.id), { jobId: job.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    await this.log(user, 'SNMP_CREDENTIAL_TEST_QUEUED', 'SnmpCredential', credential.id, { deviceId, purpose, jobId: job.id });
    return job;
  }

  async poll(deviceId: string, user: AuthenticatedUser) {
    await this.device(deviceId, user, 'UPDATE');
    const config = await this.prisma.snmpDeviceConfig.findUnique({ where: { deviceId } });
    if (!config?.enabled) throw new ConflictException({ code: 'SNMP_NOT_ENABLED', message: 'Ativa o SNMP neste equipamento.' });
    const credential = await this.prisma.snmpCredential.findUnique({ where: { deviceId_purpose: { deviceId, purpose: 'READ' } } });
    if (!credential) throw new ConflictException({ code: 'SNMP_READ_CREDENTIAL_REQUIRED', message: 'Configura uma credencial de leitura.' });
    const active = await this.prisma.snmpJob.count({ where: { deviceId, type: 'POLL', status: { in: ['PENDING', 'RUNNING'] } } });
    if (active) throw new ConflictException({ code: 'SNMP_JOB_ALREADY_ACTIVE', message: 'Já existe uma sincronização ativa.' });
    const job = await this.prisma.snmpJob.create({ data: { deviceId, credentialId: credential.id, type: 'POLL', requestedBy: user.id } });
    await this.queue.add(SNMP_JOB_NAMES.pollJob, snmpPayload(job.id), { jobId: job.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    await this.log(user, 'SNMP_POLL_QUEUED', 'Device', deviceId, { jobId: job.id });
    return job;
  }

  async reviewDrift(id: string, dto: ReviewSnmpDriftDto, user: AuthenticatedUser) {
    const drift = await this.prisma.snmpDrift.findUnique({ where: { id } });
    if (!drift) throw new NotFoundException('Divergência SNMP não encontrada');
    await this.device(drift.deviceId, user, 'UPDATE');
    const updated = await this.prisma.snmpDrift.update({ where: { id }, data: { status: dto.status, reviewedBy: user.id, reviewedAt: new Date() } });
    await this.log(user, 'SNMP_DRIFT_REVIEWED', 'SnmpDrift', id, { status: dto.status });
    return updated;
  }

  async previewWrite(deviceId: string, dto: CreateSnmpWritePreviewDto, user: AuthenticatedUser) {
    await this.device(deviceId, user, 'UPDATE');
    let template;
    try { template = validateSetTemplate({ operation: dto.operation, ...dto.parameters }); }
    catch { throw new BadRequestException({ code: 'SNMP_SET_TEMPLATE_INVALID', message: 'Os parâmetros do template SNMP SET são inválidos.' }); }
    if (template.operation === 'INTERFACE_ADMIN_STATUS') {
      const belongsToDevice = await this.prisma.deviceInterface.count({ where: { id: template.interfaceId, deviceId } });
      if (!belongsToDevice) throw new BadRequestException({ code: 'SNMP_INTERFACE_DEVICE_MISMATCH', message: 'A interface não pertence ao equipamento selecionado.' });
    }
    const item = await this.prisma.snmpWriteRequest.create({ data: { deviceId, operation: dto.operation, parameters: template as any, desiredValues: template as any, requestedBy: user.id, status: 'PREVIEW' } });
    await this.log(user, 'SNMP_SET_PREVIEW_CREATED', 'SnmpWriteRequest', item.id, { deviceId, operation: dto.operation });
    return item;
  }

  async executeWrite(id: string, user: AuthenticatedUser) {
    if (process.env.SNMP_SET_ENABLED !== 'true') throw new ForbiddenException({ code: 'SNMP_SET_DISABLED', message: 'As operações SNMP SET estão desativadas.' });
    const request = await this.prisma.snmpWriteRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Pedido SNMP SET não encontrado');
    if (request.status !== 'PREVIEW') throw new ConflictException({ code: 'SNMP_SET_REQUEST_NOT_PREVIEW', message: 'O pedido já foi submetido.' });
    await this.device(request.deviceId, user, 'UPDATE');
    const credential = await this.prisma.snmpCredential.findUnique({ where: { deviceId_purpose: { deviceId: request.deviceId, purpose: 'WRITE' } } });
    if (!credential) throw new ConflictException({ code: 'SNMP_WRITE_CREDENTIAL_REQUIRED', message: 'Configura uma credencial de escrita separada.' });
    const { job, updated } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.snmpWriteRequest.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'PENDING' } });
      if (claimed.count !== 1) throw new ConflictException({ code: 'SNMP_SET_REQUEST_ALREADY_CLAIMED', message: 'O pedido já foi submetido.' });
      const job = await tx.snmpJob.create({ data: { deviceId: request.deviceId, credentialId: credential.id, type: 'SET', requestedBy: user.id } });
      const updated = await tx.snmpWriteRequest.update({ where: { id }, data: { jobId: job.id } });
      return { job, updated };
    });
    await this.queue.add(SNMP_JOB_NAMES.set, snmpPayload(job.id), { jobId: job.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    await this.log(user, 'SNMP_SET_QUEUED', 'SnmpWriteRequest', id, { deviceId: request.deviceId, operation: request.operation, jobId: job.id });
    return updated;
  }

  async rotateCredentials(user: AuthenticatedUser) {
    const keyring = this.keyring();
    const [credentials, enrollments] = await Promise.all([this.prisma.snmpCredential.findMany(), this.prisma.snmpTrapEnrollment.findMany()]);
    let rotated = 0;
    for (const credential of credentials) {
      if (credential.keyId === keyring.activeKeyId) continue;
      const envelope = rewrapCredential(credential, keyring);
      await this.prisma.snmpCredential.update({ where: { id: credential.id }, data: { wrappedDek: envelope.wrappedDek, wrapIv: envelope.wrapIv, wrapAuthTag: envelope.wrapAuthTag, keyId: envelope.keyId } });
      await this.log(user, 'SNMP_CREDENTIAL_ROTATED', 'SnmpCredential', credential.id, { deviceId: credential.deviceId, previousKeyId: credential.keyId, keyId: envelope.keyId });
      rotated++;
    }
    for (const enrollment of enrollments) {
      if (enrollment.keyId === keyring.activeKeyId) continue;
      const envelope = rewrapCredential(enrollment, keyring);
      await this.prisma.snmpTrapEnrollment.update({ where: { id: enrollment.id }, data: { wrappedDek: envelope.wrappedDek, wrapIv: envelope.wrapIv, wrapAuthTag: envelope.wrapAuthTag, keyId: envelope.keyId } });
      await this.log(user, 'SNMP_TRAP_ENROLLMENT_ROTATED', 'SnmpTrapEnrollment', enrollment.id, { siteId: enrollment.siteId, previousKeyId: enrollment.keyId, keyId: envelope.keyId });
      rotated++;
    }
    await this.log(user, 'SNMP_CREDENTIALS_ROTATED', 'SnmpCredential', keyring.activeKeyId, { rotated });
    return { rotated, activeKeyId: keyring.activeKeyId };
  }

  private assertEnrollmentOperator(user: AuthenticatedUser) {
    if (!user.roles.includes('ADMIN') && !user.roles.includes('NETWORK_OPERATOR')) throw new ForbiddenException('Sem permissão para aceitar traps neste scope.');
  }

  private async validateOnboardingAssets(type: string, modelId?: string, frontAssetId?: string) {
    if (modelId) {
      const model = await this.prisma.deviceModel.findUnique({ where: { id: modelId }, select: { type: true, portLayout: true, supportsNetworkPorts: true, networkPortCount: true, portCount: true } });
      if (!model) throw new NotFoundException('Modelo não encontrado');
      if (model.type && model.type !== type) throw new BadRequestException({ code: 'SNMP_ONBOARDING_MODEL_TYPE_MISMATCH', message: 'O modelo não corresponde ao tipo de equipamento.' });
      if (model.supportsNetworkPorts && (model.networkPortCount || model.portCount) && !Array.isArray((model.portLayout as any)?.ports)) throw new ConflictException({ code: 'SNMP_ONBOARDING_MODEL_LAYOUT_REQUIRED', message: 'O modelo com portas exige um layout definido.' });
    }
    if (frontAssetId && await this.prisma.assetFile.count({ where: { id: frontAssetId } }) !== 1) throw new NotFoundException('Imagem frontal não encontrada');
  }

  private async validateOnboardingRack(dto: SnmpOnboardingDeviceDto, db: any = this.prisma) {
    if (!dto.rackId) {
      if (dto.rackUnitStart || dto.rackUnitSize) throw new BadRequestException({ code: 'SNMP_ONBOARDING_RACK_REQUIRED', message: 'Seleciona um bastidor antes de definir a posição.' });
      return;
    }
    if (!dto.rackUnitStart || !dto.rackUnitSize) throw new BadRequestException({ code: 'SNMP_ONBOARDING_RACK_POSITION_REQUIRED', message: 'Define a unidade inicial e o tamanho no bastidor.' });
    const rack = await db.rack.findUnique({ where: { id: dto.rackId }, select: { units: true, room: { select: { building: { select: { siteId: true } } } }, devices: { select: { rackUnitStart: true, rackUnitSize: true } } } });
    if (!rack) throw new NotFoundException('Bastidor não encontrado');
    if (rack.room.building.siteId !== dto.siteId) throw new ConflictException({ code: 'SNMP_ONBOARDING_RACK_SITE_MISMATCH', message: 'O bastidor não pertence ao Site selecionado.' });
    const end = dto.rackUnitStart + dto.rackUnitSize - 1;
    if (end > rack.units) throw new ConflictException({ code: 'SNMP_ONBOARDING_RACK_BOUNDS', message: 'A posição excede as unidades do bastidor.' });
    if (rack.devices.some((device: { rackUnitStart: number | null; rackUnitSize: number | null }) => device.rackUnitStart && device.rackUnitSize && dto.rackUnitStart! <= device.rackUnitStart + device.rackUnitSize - 1 && end >= device.rackUnitStart)) throw new ConflictException({ code: 'SNMP_ONBOARDING_RACK_OCCUPIED', message: 'A posição indicada já está ocupada.' });
  }

  async listEnrollments(user: AuthenticatedUser, siteId?: string) {
    const sites = siteId ? [siteId] : await this.access.visibleUnplacedSiteIds(user);
    if (siteId) await this.access.assertSite(user, 'READ', siteId, 'DEVICE', 'SWITCH');
    const items = await this.prisma.snmpTrapEnrollment.findMany({ where: { siteId: { in: sites }, expiresAt: { gt: new Date() } }, include: { site: { select: { id: true, name: true, code: true } } }, orderBy: [{ status: 'asc' }, { lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] });
    return items.map((item) => this.publicEnrollment(item));
  }

  async createEnrollment(dto: CreateSnmpTrapEnrollmentDto, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'CREATE', dto.siteId, 'DEVICE', 'SWITCH');
    if (net.isIP(dto.sourceAddress) !== 4) throw new BadRequestException({ code: 'SNMP_ENROLLMENT_IP_INVALID', message: 'O pré-registo exige um endereço IPv4 válido.' });
    const secret = this.credentialSecret(dto, { compatibilitySha1: dto.compatibilitySha1 === true });
    const metadata = this.credentialMetadata(dto);
    const item = await this.prisma.$transaction(async (tx) => {
      await this.lockCredentialPolicy(tx);
      if (await tx.device.count({ where: { siteId: dto.siteId, managementIp: dto.sourceAddress } })) throw new ConflictException({ code: 'SNMP_ENROLLMENT_DEVICE_EXISTS', message: 'Já existe um equipamento neste Site com esse IP de gestão.' });
      if (await tx.snmpTrapEnrollment.count({ where: { siteId: dto.siteId, sourceAddress: dto.sourceAddress } })) throw new ConflictException({ code: 'SNMP_ENROLLMENT_ALREADY_EXISTS', message: 'Já existe um pré-registo ativo para este IP.' });
      const keyring = await this.assertSecretAvailable(secret, { v3TrapUsername: dto.version === 'V3' ? dto.username : undefined }, tx);
      return tx.snmpTrapEnrollment.create({ data: { siteId: dto.siteId, sourceAddress: dto.sourceAddress, version: dto.version, ...metadata, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), ...encryptCredential(secret, keyring) } });
    }, { isolationLevel: 'ReadCommitted' }).catch((error: any) => {
      if (error?.code === 'P2002') throw new ConflictException({ code: 'SNMP_ENROLLMENT_ALREADY_EXISTS', message: 'Já existe um pré-registo ativo para este IP.' });
      if (error?.code === 'P2034') throw new ConflictException({ code: 'SNMP_ENROLLMENT_CONCURRENT_UPDATE', message: 'O pré-registo foi alterado por outra operação.' });
      throw error;
    });
    await this.log(user, 'SNMP_TRAP_ENROLLMENT_CREATED', 'SnmpTrapEnrollment', item.id, { siteId: dto.siteId, sourceAddress: dto.sourceAddress, version: dto.version });
    await this.reloadTrapCredentials(item.id);
    return this.publicEnrollment(item);
  }

  private publicEnrollment(item: any) { const { ciphertext, iv, authTag, wrappedDek, wrapIv, wrapAuthTag, ...safe } = item; return safe; }

  async renewEnrollment(id: string, user: AuthenticatedUser) {
    const item = await this.prisma.snmpTrapEnrollment.findUnique({ where: { id } }); if (!item) throw new NotFoundException('Enrollment não encontrado');
    await this.access.assertSite(user, 'UPDATE', item.siteId, 'DEVICE', 'SWITCH');
    const updated = await this.prisma.snmpTrapEnrollment.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
    await this.log(user, 'SNMP_TRAP_ENROLLMENT_RENEWED', 'SnmpTrapEnrollment', id, { siteId: item.siteId }); await this.reloadTrapCredentials(id); return this.publicEnrollment(updated);
  }

  async deleteEnrollment(id: string, user: AuthenticatedUser) {
    const item = await this.prisma.snmpTrapEnrollment.findUnique({ where: { id } }); if (!item) throw new NotFoundException('Enrollment não encontrado');
    await this.access.assertSite(user, 'DELETE', item.siteId, 'DEVICE', 'SWITCH');
    await this.prisma.$transaction([this.prisma.snmpTrapEvent.updateMany({ where: { enrollmentId: id }, data: { enrollmentId: null, status: 'UNMATCHED' } }), this.prisma.snmpTrapEnrollment.delete({ where: { id } })]);
    await this.log(user, 'SNMP_TRAP_ENROLLMENT_CANCELLED', 'SnmpTrapEnrollment', id, { siteId: item.siteId }); await this.reloadTrapCredentials(id); return { success: true };
  }

  private ipv4Number(address: string) { const parts = address.split('.').map(Number); return parts.length === 4 && parts.every((n) => n >= 0 && n <= 255) ? parts.reduce((n, p) => (n * 256) + p, 0) : null; }
  private inCidr(address: string, cidr: string) { const ip = this.ipv4Number(address); const [base, prefixText] = cidr.split('/'); const network = this.ipv4Number(base); const prefix = Number(prefixText); if (ip === null || network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false; const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; return ((ip & mask) >>> 0) === ((network & mask) >>> 0); }
  private mostSpecificSubnet<T extends { cidr: string }>(address: string, subnets: T[]) {
    return subnets.filter((subnet) => this.inCidr(address, subnet.cidr)).sort((a, b) => Number(b.cidr.split('/')[1]) - Number(a.cidr.split('/')[1]))[0];
  }

  async acceptEnrollment(id: string, dto: AcceptSnmpEnrollmentDto, user: AuthenticatedUser) {
    this.assertEnrollmentOperator(user);
    const deviceName = dto.name.trim();
    if (!deviceName) throw new BadRequestException({ code: 'SNMP_DEVICE_NAME_REQUIRED', message: 'Indica o nome do equipamento.' });
    const enrollment = await this.prisma.snmpTrapEnrollment.findUnique({ where: { id } }); if (!enrollment) throw new ConflictException({ code: 'SNMP_ENROLLMENT_ALREADY_CLAIMED', message: 'O candidato já foi aceite ou removido.' });
    if (enrollment.expiresAt <= new Date()) throw new ConflictException({ code: 'SNMP_ENROLLMENT_EXPIRED', message: 'O enrollment expirou.' });
    if (enrollment.status !== 'DISCOVERED' || !enrollment.firstSeenAt) throw new ConflictException({ code: 'SNMP_ENROLLMENT_NOT_DISCOVERED', message: 'O equipamento ainda não enviou uma trap autenticada.' });
    await this.access.assertSite(user, 'CREATE', enrollment.siteId, 'DEVICE', dto.type);
    await this.validateOnboardingAssets(dto.type, dto.modelId, dto.frontAssetId);
    const subnets = await this.prisma.subnet.findMany({ where: { siteId: enrollment.siteId, version: 4 }, select: { id: true, cidr: true } });
    const subnet = this.mostSpecificSubnet(enrollment.sourceAddress, subnets);
    if (!subnet) throw new ConflictException({ code: 'SNMP_ENROLLMENT_NO_SUBNET', message: 'Não existe subnet IPv4 compatível no Site.' });
    const keyring = this.keyring(); const { ciphertext, iv, authTag, wrappedDek, wrapIv, wrapAuthTag, keyId } = rewrapCredential(enrollment as any, keyring);
    let result: { device: any; eventIds: string[]; credentialId: string };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockCredentialPolicy(tx);
        const current = await tx.snmpTrapEnrollment.findUnique({ where: { id } });
        if (!current) throw new ConflictException({ code: 'SNMP_ENROLLMENT_ALREADY_CLAIMED', message: 'O candidato já foi aceite ou removido.' });
        if (current.expiresAt <= new Date() || current.status !== 'DISCOVERED') throw new ConflictException({ code: 'SNMP_ENROLLMENT_NOT_AVAILABLE', message: 'O candidato já não está disponível.' });
        if (await tx.device.count({ where: { siteId: current.siteId, managementIp: current.sourceAddress } })) throw new ConflictException({ code: 'SNMP_ENROLLMENT_DEVICE_EXISTS', message: 'Já existe um equipamento neste Site com esse IP.' });
        const occupied = await tx.ipAddress.findFirst({ where: { address: current.sourceAddress, deviceId: { not: null }, subnet: { siteId: current.siteId } }, select: { id: true } });
        if (occupied) throw new ConflictException({ code: 'SNMP_ENROLLMENT_IP_OCCUPIED', message: 'O IP já está associado a outro equipamento.' });
        const existingIp = await tx.ipAddress.findUnique({ where: { subnetId_address: { subnetId: subnet.id, address: current.sourceAddress } }, select: { id: true, deviceId: true } });
        const device = await tx.device.create({ data: { name: deviceName, type: dto.type, hostname: dto.hostname?.trim() || undefined, modelId: dto.modelId, frontAssetId: dto.frontAssetId, siteId: current.siteId, managementIp: current.sourceAddress, source: 'SNMP', status: 'UNKNOWN' } });
        if (existingIp) {
          const linked = await tx.ipAddress.updateMany({ where: { id: existingIp.id, deviceId: null }, data: { deviceId: device.id, source: 'SNMP', state: 'OCCUPIED' } });
          if (linked.count !== 1) throw new ConflictException({ code: 'SNMP_ENROLLMENT_IP_OCCUPIED', message: 'O IP foi associado por outra operação.' });
        } else await tx.ipAddress.create({ data: { subnetId: subnet.id, address: current.sourceAddress, version: 4, deviceId: device.id, source: 'SNMP', state: 'OCCUPIED' } });
        const credential = await tx.snmpCredential.create({ data: { deviceId: device.id, purpose: 'TRAP', version: current.version, username: current.username, authProtocol: current.authProtocol, privProtocol: current.privProtocol, ciphertext, iv, authTag, wrappedDek, wrapIv, wrapAuthTag, keyId } });
        const events = await tx.snmpTrapEvent.findMany({ where: { enrollmentId: id }, select: { id: true } });
        await tx.snmpTrapEvent.updateMany({ where: { enrollmentId: id }, data: { deviceId: device.id, credentialId: credential.id, enrollmentId: null, status: 'PENDING' } });
        await tx.snmpTrapEnrollment.delete({ where: { id } });
        return { device, credentialId: credential.id, eventIds: events.map((event) => event.id) };
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error: any) {
      if (error instanceof ConflictException) throw error;
      if (['P2002', 'P2025', 'P2034'].includes(error?.code)) throw new ConflictException({ code: 'SNMP_ENROLLMENT_CONCURRENT_UPDATE', message: 'O candidato foi alterado por outra operação.' });
      throw error;
    }
    await this.reloadTrapCredentials(result.credentialId);
    for (const eventId of result.eventIds) await this.queue.add(SNMP_JOB_NAMES.processTrap, snmpPayload(eventId), { jobId: eventId, removeOnComplete: 500, removeOnFail: 500 }).catch(() => undefined);
    await this.log(user, 'SNMP_TRAP_ENROLLMENT_ACCEPTED', 'Device', result.device.id, { siteId: enrollment.siteId, sourceAddress: enrollment.sourceAddress, deviceName, trapCount: result.eventIds.length }); return result.device;
  }

  async onboardDevice(dto: SnmpOnboardingDeviceDto, user: AuthenticatedUser) {
    if (dto.rackId) await this.access.assertRack(user, 'CREATE', dto.rackId, 'DEVICE', dto.type);
    else await this.access.assertSite(user, 'CREATE', dto.siteId, 'DEVICE', dto.type);
    if (net.isIP(dto.managementIp) === 0) throw new BadRequestException({ code: 'SNMP_MANAGEMENT_IP_REQUIRED', message: 'Define um IP de gestão válido.' });
    await this.validateOnboardingAssets(dto.type, dto.modelId, dto.frontAssetId);
    await this.validateOnboardingRack(dto);
    const config = { enabled: dto.config.enabled, port: dto.config.port ?? 161, intervalMinutes: dto.config.intervalMinutes ?? 15, timeoutMs: dto.config.timeoutMs ?? 5000, retries: dto.config.retries ?? 2, compatibilitySha1: dto.config.compatibilitySha1 ?? false };
    const readSecret = this.credentialSecret(dto.readCredential, config);
    const trapSecret = dto.trapCredential ? this.credentialSecret(dto.trapCredential, config) : undefined;
    if (trapSecret && JSON.stringify(readSecret) === JSON.stringify(trapSecret)) throw new ConflictException({ code: 'SNMP_CREDENTIAL_PURPOSE_REUSE', message: 'READ e TRAP exigem credenciais distintas.' });
    const readMetadata = this.credentialMetadata(dto.readCredential); const trapMetadata = dto.trapCredential ? this.credentialMetadata(dto.trapCredential) : undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockCredentialPolicy(tx);
      await this.validateOnboardingRack(dto, tx);
      if (await tx.device.count({ where: { siteId: dto.siteId, managementIp: dto.managementIp } })) throw new ConflictException({ code: 'SNMP_ONBOARDING_DEVICE_EXISTS', message: 'Já existe um equipamento neste Site com esse IP.' });
      const keyring = await this.assertSecretAvailable(readSecret, {}, tx);
      if (trapSecret) await this.assertSecretAvailable(trapSecret, { v3TrapUsername: dto.trapCredential?.version === 'V3' ? dto.trapCredential.username : undefined }, tx);
      const readEnvelope = encryptCredential(readSecret, keyring); const trapEnvelope = trapSecret ? encryptCredential(trapSecret, keyring) : undefined;
      const device = await tx.device.create({ data: { name: dto.name, type: dto.type, hostname: dto.hostname, managementIp: dto.managementIp, modelId: dto.modelId, frontAssetId: dto.frontAssetId, siteId: dto.siteId, rackId: dto.rackId, rackUnitStart: dto.rackUnitStart, rackUnitSize: dto.rackUnitSize, source: 'MANUAL', status: 'UNKNOWN' } });
      const snmpConfig = await tx.snmpDeviceConfig.create({ data: { deviceId: device.id, ...config } });
      await tx.snmpCredential.create({ data: { deviceId: device.id, purpose: 'READ', version: dto.readCredential.version, label: dto.readCredential.label, ...readMetadata, ...readEnvelope } });
      let trapCredentialId: string | undefined;
      if (dto.trapCredential && trapEnvelope && trapMetadata) trapCredentialId = (await tx.snmpCredential.create({ data: { deviceId: device.id, purpose: 'TRAP', version: dto.trapCredential.version, label: dto.trapCredential.label, ...trapMetadata, ...trapEnvelope } })).id;
      return { device, snmpConfig, trapCredentialId };
    }, { isolationLevel: 'ReadCommitted' }).catch((error: any) => {
      if (error instanceof ConflictException) throw error;
      if (error?.code === 'P2002') throw new ConflictException({ code: 'SNMP_ONBOARDING_DEVICE_EXISTS', message: 'Já existe um equipamento neste Site com esse IP.' });
      if (error?.code === 'P2034') throw new ConflictException({ code: 'SNMP_ONBOARDING_CONCURRENT_UPDATE', message: 'O onboarding concorreu com outra operação. Repete o pedido.' });
      throw error;
    });
    let schedulerPending = false;
    await this.scheduleConfig(result.snmpConfig).catch(async () => { schedulerPending = result.snmpConfig.enabled; await this.prisma.snmpDeviceConfig.update({ where: { id: result.snmpConfig.id }, data: { nextPollAt: null, lastErrorCode: 'SNMP_QUEUE_UNAVAILABLE' } }).catch(() => undefined); });
    if (result.trapCredentialId) await this.reloadTrapCredentials(result.trapCredentialId);
    await this.log(user, 'SNMP_DEVICE_ONBOARDED', 'Device', result.device.id, { siteId: dto.siteId, credentials: ['READ', ...(dto.trapCredential ? ['TRAP'] : [])], schedulerPending }); return result.device;
  }
}
