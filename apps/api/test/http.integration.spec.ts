import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { CanActivate, ConflictException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@simoes/database';
import { encryptCredential, parseKeyring } from '@simoes/snmp-core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { AuthGuard } from '../src/auth/auth.guard';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { KeycloakAdminService } from '../src/settings/keycloak-admin.service';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('HTTP integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  scoped: '10000000-0000-4000-8000-000000000002',
  legacy: '10000000-0000-4000-8000-000000000003',
  auditor: '10000000-0000-4000-8000-000000000004',
  readonly: '10000000-0000-4000-8000-000000000005',
  systems: '10000000-0000-4000-8000-000000000006',
  siteA: '20000000-0000-4000-8000-000000000001',
  siteB: '20000000-0000-4000-8000-000000000002',
  vlanA: '30000000-0000-4000-8000-000000000001',
  vlanB: '30000000-0000-4000-8000-000000000002',
  subnetA: '40000000-0000-4000-8000-000000000001',
  subnetB: '40000000-0000-4000-8000-000000000002',
  hostMulti: '50000000-0000-4000-8000-000000000001',
  hostManual: '50000000-0000-4000-8000-000000000002',
  discoveryJob: '60000000-0000-4000-8000-000000000001',
  discoveryResult: '70000000-0000-4000-8000-000000000001',
  groupRead: '80000000-0000-4000-8000-000000000001',
  groupWrite: '80000000-0000-4000-8000-000000000002',
  buildingA: '90000000-0000-4000-8000-000000000001',
  roomA: '91000000-0000-4000-8000-000000000001',
  roomSibling: '91000000-0000-4000-8000-000000000002',
  rackA: '91500000-0000-4000-8000-000000000001',
  deviceA: '92000000-0000-4000-8000-000000000001',
  deviceB: '92000000-0000-4000-8000-000000000002',
  enrollmentA: '93000000-0000-4000-8000-000000000001',
  enrollmentB: '93000000-0000-4000-8000-000000000002',
  enrollmentCandidate: '93000000-0000-4000-8000-000000000003',
  enrollmentRace: '93000000-0000-4000-8000-000000000004',
};

class HeaderAuthGuard implements CanActivate {
  private readonly reflector = new Reflector();
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const username = request.headers['x-test-user'];
    if (!username) throw new UnauthorizedException();
    const user = await prisma.user.findUnique({ where: { username }, include: { roles: true } });
    if (!user) throw new UnauthorizedException();
    request.user = { id: user.id, externalId: user.externalId, username: user.username, roles: user.roles.map((entry) => entry.role) };
    return true;
  }
}

let app: NestFastifyApplication;
let keyringDirectory: string;
let originalKeyringFile: string | undefined;
let testKeyring: ReturnType<typeof parseKeyring>;
const json = (response: { body: string }) => JSON.parse(response.body);
const request = (method: string, url: string, persona?: string, payload?: unknown) => app.inject({
  method: method as never,
  url,
  headers: { ...(persona ? { 'x-test-user': persona } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) },
  payload: payload ? JSON.stringify(payload) : undefined,
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "Notification", "RoleRequest", "ApplicationLinkRole", "ApplicationLink", "RipeImport", "InfrastructurePermission", "AccessGroupSitePermission", "AccessGroupSite", "AccessGroupMember", "AccessGroup",
    "DiscoveryResult", "DiscoveryJob", "DiscoverySchedule", "Service", "IpAddress", "InterfaceVlan", "DeviceInterface",
    "Host", "Device", "DeviceModel", "AssetFile", "Rack", "RackModel", "Room", "Building", "NatRule", "Subnet", "Vrf",
    "Vlan", "Site", "AuditLog", "UserRole", "User", "SystemSettings" RESTART IDENTITY CASCADE`);
  await prisma.systemSettings.create({ data: { organizationName: 'HTTP QA', organizationCode: 'HTTP-QA', setupCompleted: true, discoveryAllowedCidrs: ['10.250.0.0/16'] } });
  const personas = [
    [ids.admin, 'qa-admin', 'ADMIN'],
    [ids.scoped, 'qa-network-scoped', 'NETWORK_OPERATOR'],
    [ids.legacy, 'qa-network-legacy', 'NETWORK_OPERATOR'],
    [ids.auditor, 'qa-auditor', 'AUDITOR'],
    [ids.readonly, 'qa-readonly', 'READ_ONLY'],
    [ids.systems, 'qa-systems-scoped', 'SYSTEMS_OPERATOR'],
  ] as const;
  for (const [id, username, role] of personas) await prisma.user.create({ data: { id, externalId: `http-${username}`, username, roles: { create: { role } } } });
  await prisma.site.createMany({ data: [{ id: ids.siteA, name: 'HTTP Site A', code: 'HTTP-A' }, { id: ids.siteB, name: 'HTTP Site B', code: 'HTTP-B' }] });
  await prisma.building.create({ data: { id: ids.buildingA, name: 'HTTP Building A', siteId: ids.siteA } });
  await prisma.room.createMany({ data: [{ id: ids.roomA, name: 'HTTP Room A', buildingId: ids.buildingA }, { id: ids.roomSibling, name: 'HTTP Room Sibling', buildingId: ids.buildingA }] });
  await prisma.rack.create({ data: { id: ids.rackA, name: 'HTTP Rack A', roomId: ids.roomA } });
  await prisma.device.createMany({ data: [
    { id: ids.deviceA, name: 'HTTP Switch A', type: 'SWITCH', managementIp: '10.250.1.2', siteId: ids.siteA, rackId: ids.rackA },
    { id: ids.deviceB, name: 'HTTP Switch B', type: 'SWITCH', managementIp: '10.250.2.2', siteId: ids.siteB },
  ] });
  const enrollmentEnvelope = encryptCredential({ community: 'http-trap-site-a' }, testKeyring);
  await prisma.snmpTrapEnrollment.createMany({ data: [
    { id: ids.enrollmentA, siteId: ids.siteA, sourceAddress: '10.250.1.80', version: 'V2C', expiresAt: new Date(Date.now() + 60_000), ...enrollmentEnvelope },
    { id: ids.enrollmentB, siteId: ids.siteB, sourceAddress: '10.250.2.80', version: 'V2C', expiresAt: new Date(Date.now() + 60_000), ...encryptCredential({ community: 'http-trap-site-b' }, testKeyring) },
    { id: ids.enrollmentCandidate, siteId: ids.siteA, sourceAddress: '10.250.1.81', version: 'V2C', status: 'DISCOVERED', firstSeenAt: new Date(), lastSeenAt: new Date(), trapCount: 1, expiresAt: new Date(Date.now() + 60_000), ...encryptCredential({ community: 'http-candidate-trap' }, testKeyring) },
    { id: ids.enrollmentRace, siteId: ids.siteA, sourceAddress: '10.250.1.82', version: 'V2C', status: 'DISCOVERED', firstSeenAt: new Date(), lastSeenAt: new Date(), trapCount: 1, expiresAt: new Date(Date.now() + 60_000), ...encryptCredential({ community: 'http-race-trap' }, testKeyring) },
  ] });
  await prisma.snmpTrapEvent.createMany({ data: [
    { enrollmentId: ids.enrollmentCandidate, sourceAddress: '10.250.1.81', sourcePort: 50162, version: 'V2C', authIdentity: 'redacted-candidate', pduType: 'TrapV2', varbinds: [], status: 'DISCOVERED', expiresAt: new Date(Date.now() + 60_000) },
    { enrollmentId: ids.enrollmentRace, sourceAddress: '10.250.1.82', sourcePort: 50162, version: 'V2C', authIdentity: 'redacted-race', pduType: 'TrapV2', varbinds: [], status: 'DISCOVERED', expiresAt: new Date(Date.now() + 60_000) },
  ] });
  await prisma.vlan.createMany({ data: [{ id: ids.vlanA, vlanId: 2501, name: 'HTTP VLAN A', siteId: ids.siteA }, { id: ids.vlanB, vlanId: 2502, name: 'HTTP VLAN B', siteId: ids.siteB }] });
  await prisma.subnet.createMany({ data: [
    { id: ids.subnetA, cidr: '10.250.1.0/24', version: 4, siteId: ids.siteA, vlanId: ids.vlanA },
    { id: ids.subnetB, cidr: '10.250.2.0/24', version: 4, siteId: ids.siteB, vlanId: ids.vlanB },
  ] });
  await prisma.host.createMany({ data: [
    { id: ids.hostMulti, name: 'HTTP Multi Host', status: 'ACTIVE', source: 'MANUAL' },
    { id: ids.hostManual, name: 'HTTP Manual Host', hostname: 'manual.example', status: 'ACTIVE', notes: 'preserve-me', source: 'MANUAL' },
  ] });
  await prisma.ipAddress.createMany({ data: [
    { address: '10.250.1.10', subnetId: ids.subnetA, hostId: ids.hostMulti, state: 'OCCUPIED', source: 'MANUAL' },
    { address: '10.250.2.10', subnetId: ids.subnetB, hostId: ids.hostMulti, state: 'OCCUPIED', source: 'MANUAL' },
    { address: '10.250.1.55', subnetId: ids.subnetA, hostId: ids.hostManual, hostname: 'manual.example', state: 'OCCUPIED', source: 'MANUAL' },
  ] });
  await prisma.service.create({ data: { hostId: ids.hostManual, name: 'Manual HTTP', protocol: 'TCP', port: 80, status: 'ACTIVE', notes: 'preserve-service', source: 'MANUAL' } });
  await prisma.discoveryJob.create({ data: { id: ids.discoveryJob, name: 'HTTP idempotency', subnetId: ids.subnetA, methods: ['ICMP', 'TCP'], tcpPorts: [22, 443], status: 'COMPLETED' } });
  await prisma.discoveryResult.create({ data: { id: ids.discoveryResult, jobId: ids.discoveryJob, address: '10.250.1.55', hostname: 'observed.example', icmpReachable: true, responseMs: 4, openPorts: [22, 443] } });
  await prisma.accessGroup.createMany({ data: [
    { id: ids.groupRead, name: 'HTTP Scoped Read' },
    { id: ids.groupWrite, name: 'HTTP Scoped Write' },
  ] });
  await prisma.accessGroupMember.createMany({ data: [{ groupId: ids.groupRead, userId: ids.scoped }, { groupId: ids.groupRead, userId: ids.auditor }, { groupId: ids.groupRead, userId: ids.readonly }, { groupId: ids.groupRead, userId: ids.systems }, { groupId: ids.groupWrite, userId: ids.scoped }] });
  await prisma.accessGroupSite.createMany({ data: [{ groupId: ids.groupRead, siteId: ids.siteA }, { groupId: ids.groupWrite, siteId: ids.siteA }] });
  await prisma.accessGroupSitePermission.createMany({ data: [
    { groupId: ids.groupRead, siteId: ids.siteA, permission: 'READ' },
    { groupId: ids.groupWrite, siteId: ids.siteA, permission: 'CREATE' },
    { groupId: ids.groupWrite, siteId: ids.siteA, permission: 'UPDATE' },
    { groupId: ids.groupWrite, siteId: ids.siteA, permission: 'DISCOVER' },
  ] });
  await prisma.infrastructurePermission.createMany({ data: [
    { groupId: ids.groupRead, scopeType: 'ROOM', scopeId: ids.roomA, permission: 'READ' },
    { groupId: ids.groupWrite, scopeType: 'SITE', scopeId: ids.siteA, permission: 'CREATE' },
    { groupId: ids.groupWrite, scopeType: 'ROOM', scopeId: ids.roomA, permission: 'UPDATE' },
  ] });
}

before(async () => {
  originalKeyringFile = process.env.SNMP_KEYRING_FILE;
  keyringDirectory = await mkdtemp(join(tmpdir(), 'snmp-http-test-'));
  const keyringDocument = JSON.stringify({ activeKeyId: 'http-test', keys: { 'http-test': randomBytes(32).toString('base64') } });
  await writeFile(join(keyringDirectory, 'keyring.json'), keyringDocument, { mode: 0o600 });
  process.env.SNMP_KEYRING_FILE = join(keyringDirectory, 'keyring.json');
  testKeyring = parseKeyring(keyringDocument);
  await prisma.$connect();
  await resetDatabase();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AuthGuard).useClass(HeaderAuthGuard)
    .overrideProvider(KeycloakAdminService).useValue({
      listUsers: async () => ({ items: [], page: 1, pageSize: 25, total: 0 }),
      effectiveRoles: async () => [],
      grantRoles: async () => ({ directRoles: [], inheritedRoles: [], effectiveRoles: [] }),
      updateRoles: async () => { throw new ConflictException({ code: 'LAST_ADMIN_REQUIRED', message: 'A aplicação tem de manter pelo menos um ADMIN ativo.' }); },
    })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { swagger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(async () => {
  await app?.close();
  await prisma.$disconnect();
  if (originalKeyringFile === undefined) delete process.env.SNMP_KEYRING_FILE;
  else process.env.SNMP_KEYRING_FILE = originalKeyringFile;
  await rm(keyringDirectory, { recursive: true, force: true });
});

test('enforces authentication and persona-level RBAC over HTTP', async () => {
  assert.equal((await request('GET', '/api/v1/sites')).statusCode, 401);
  assert.equal((await request('GET', '/api/v1/sites', 'qa-readonly')).statusCode, 200);
  assert.equal((await request('POST', '/api/v1/ip-addresses', 'qa-readonly', { address: '10.250.1.20', subnetId: ids.subnetA })).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/audit/events', 'qa-auditor')).statusCode, 200);
  assert.equal((await request('POST', '/api/v1/ip-addresses', 'qa-auditor', { address: '10.250.1.21', subnetId: ids.subnetA })).statusCode, 403);
});

test('applies scoped visibility, inherited reads, group union, and fail-closed access', async () => {
  const visible = await request('GET', '/api/v1/sites?pageSize=20', 'qa-network-scoped');
  assert.equal(visible.statusCode, 200);
  assert.deepEqual(json(visible).items.map((site: { id: string }) => site.id), [ids.siteA]);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetA}`, 'qa-network-scoped')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetB}`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetA}`, 'qa-network-scoped', { purpose: 'Scoped update' })).statusCode, 200);
  assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetB}`, 'qa-network-scoped', { purpose: 'Denied update' })).statusCode, 404);
  assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetB}`, 'qa-network-legacy', { purpose: 'Denied without group' })).statusCode, 404);
});

test('enforces SNMP roles, Site isolation and disabled SET over HTTP', async () => {
  assert.equal((await request('GET', '/api/v1/settings/snmp-listeners', 'qa-network-scoped')).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/settings/snmp-listeners', 'qa-admin')).statusCode, 200);
  assert.equal((await request('PATCH', '/api/v1/settings/snmp-listeners', 'qa-network-scoped', { listenAll: true, interfaceIds: [] })).statusCode, 403);
  assert.equal((await request('PATCH', '/api/v1/settings/snmp-listeners', 'qa-admin', { listenAll: false, interfaceIds: [] })).statusCode, 400);
  assert.equal((await request('PATCH', '/api/v1/settings/snmp-listeners', 'qa-admin', { listenAll: true, interfaceIds: [] })).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-network-scoped')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceB}`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-auditor')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-readonly')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-systems-scoped')).statusCode, 403);

  const config = { enabled: true, port: 161, intervalMinutes: 15, timeoutMs: 1000, retries: 1, compatibilitySha1: false };
  assert.equal((await request('PATCH', `/api/v1/snmp/devices/${ids.deviceA}/config`, 'qa-network-scoped', config)).statusCode, 403);
  assert.equal((await request('PATCH', `/api/v1/snmp/devices/${ids.deviceA}/config`, 'qa-admin', config)).statusCode, 200);
  assert.equal((await request('POST', `/api/v1/snmp/devices/${ids.deviceA}/poll`, 'qa-readonly')).statusCode, 403);
  assert.equal((await request('POST', `/api/v1/snmp/devices/${ids.deviceA}/poll`, 'qa-network-scoped')).statusCode, 409);

  const preview = await request('POST', `/api/v1/snmp/devices/${ids.deviceA}/write-requests/preview`, 'qa-admin', {
    operation: 'SYSTEM_IDENTITY', parameters: { sysName: 'http-switch-a' },
  });
  assert.equal(preview.statusCode, 201);
  assert.equal((await request('POST', `/api/v1/snmp/devices/${ids.deviceA}/write-requests/preview`, 'qa-network-scoped', { operation: 'SYSTEM_IDENTITY', parameters: { sysName: 'denied' } })).statusCode, 403);
  assert.equal((await request('POST', `/api/v1/snmp/write-requests/${json(preview).id}/execute`, 'qa-admin')).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/snmp/traps/unmatched', 'qa-admin')).statusCode, 200);
  assert.equal((await request('GET', '/api/v1/snmp/traps/unmatched', 'qa-auditor')).statusCode, 403);

  const enrollments = await request('GET', `/api/v1/snmp/discovery/enrollments?siteId=${ids.siteA}`, 'qa-network-scoped');
  assert.equal(enrollments.statusCode, 200);
  assert.deepEqual(new Set(json(enrollments).map((item: { id: string }) => item.id)), new Set([ids.enrollmentA, ids.enrollmentCandidate, ids.enrollmentRace]));
  assert.equal(JSON.stringify(json(enrollments)).includes('ciphertext'), false);
  assert.equal((await request('GET', `/api/v1/snmp/discovery/enrollments?siteId=${ids.siteB}`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('POST', '/api/v1/snmp/discovery/enrollments', 'qa-network-scoped', {})).statusCode, 403);
  assert.equal((await request('DELETE', `/api/v1/snmp/discovery/enrollments/${ids.enrollmentA}`, 'qa-network-scoped')).statusCode, 403);
  assert.equal((await request('POST', `/api/v1/snmp/discovery/enrollments/${ids.enrollmentA}/accept`, 'qa-auditor', {})).statusCode, 403);
});

test('accepts SNMP candidates atomically and onboards devices without model images', async () => {
  const accepted = await request('POST', `/api/v1/snmp/discovery/enrollments/${ids.enrollmentCandidate}/accept`, 'qa-network-scoped', { name: 'HTTP Discovered Switch', type: 'SWITCH' });
  assert.equal(accepted.statusCode, 201, accepted.body);
  const acceptedDevice = json(accepted) as { id: string; name: string; source: string; rackId: string | null; modelId: string | null; frontAssetId: string | null };
  assert.equal(acceptedDevice.name, 'HTTP Discovered Switch');
  assert.equal(acceptedDevice.source, 'SNMP');
  assert.equal(acceptedDevice.rackId, null);
  assert.equal(acceptedDevice.modelId, null);
  assert.equal(acceptedDevice.frontAssetId, null);
  assert.equal(await prisma.snmpTrapEnrollment.count({ where: { id: ids.enrollmentCandidate } }), 0);
  assert.equal(await prisma.snmpCredential.count({ where: { deviceId: acceptedDevice.id, purpose: 'TRAP' } }), 1);
  assert.equal(await prisma.ipAddress.count({ where: { subnetId: ids.subnetA, address: '10.250.1.81', deviceId: acceptedDevice.id } }), 1);
  assert.equal(await prisma.snmpTrapEvent.count({ where: { deviceId: acceptedDevice.id, status: { in: ['PENDING', 'PROCESSED'] } } }), 1);

  const concurrent = await Promise.all([
    request('POST', `/api/v1/snmp/discovery/enrollments/${ids.enrollmentRace}/accept`, 'qa-admin', { name: 'HTTP Race A', type: 'SWITCH' }),
    request('POST', `/api/v1/snmp/discovery/enrollments/${ids.enrollmentRace}/accept`, 'qa-admin', { name: 'HTTP Race B', type: 'SWITCH' }),
  ]);
  assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [201, 409]);
  assert.equal(await prisma.device.count({ where: { siteId: ids.siteA, managementIp: '10.250.1.82' } }), 1);

  const onboardingPayload = {
    siteId: ids.siteA, name: 'HTTP Manual SNMP', type: 'ROUTER', managementIp: '10.250.1.83',
    rackId: ids.rackA, rackUnitStart: 20, rackUnitSize: 2,
    config: { enabled: true },
    readCredential: { version: 'V3', username: 'http-read-user', authKey: 'http-read-auth-key', privKey: 'http-read-priv-key', authProtocol: 'SHA256', privProtocol: 'AES128' },
    trapCredential: { version: 'V3', username: 'http-trap-user', authKey: 'http-trap-auth-key', privKey: 'http-trap-priv-key', authProtocol: 'SHA256', privProtocol: 'AES128' },
  };
  assert.equal((await request('POST', '/api/v1/snmp/onboarding/devices', 'qa-network-scoped', onboardingPayload)).statusCode, 403);
  const onboarded = await request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', onboardingPayload);
  assert.equal(onboarded.statusCode, 201);
  const onboardedDevice = json(onboarded) as { id: string; modelId: string | null; frontAssetId: string | null; rackId: string | null; rackUnitStart: number | null; rackUnitSize: number | null };
  assert.equal(onboardedDevice.modelId, null);
  assert.equal(onboardedDevice.frontAssetId, null);
  assert.deepEqual({ rackId: onboardedDevice.rackId, rackUnitStart: onboardedDevice.rackUnitStart, rackUnitSize: onboardedDevice.rackUnitSize }, { rackId: ids.rackA, rackUnitStart: 20, rackUnitSize: 2 });
  assert.equal(await prisma.snmpCredential.count({ where: { deviceId: onboardedDevice.id } }), 2);
  const config = await prisma.snmpDeviceConfig.findUniqueOrThrow({ where: { deviceId: onboardedDevice.id } });
  assert.deepEqual({ port: config.port, intervalMinutes: config.intervalMinutes, timeoutMs: config.timeoutMs, retries: config.retries }, { port: 161, intervalMinutes: 15, timeoutMs: 5000, retries: 2 });
  assert.equal((await request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', onboardingPayload)).statusCode, 409);

  const duplicateIpPayload = { ...onboardingPayload, name: 'HTTP Concurrent IP', managementIp: '10.250.1.84', rackId: undefined, rackUnitStart: undefined, rackUnitSize: undefined, config: { enabled: false }, readCredential: { version: 'V3', username: 'http-concurrent-ip-read', authKey: 'http-concurrent-ip-auth', privKey: 'http-concurrent-ip-priv' }, trapCredential: undefined };
  const duplicateIp = await Promise.all([
    request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', duplicateIpPayload),
    request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', duplicateIpPayload),
  ]);
  assert.deepEqual(duplicateIp.map((response) => response.statusCode).sort(), [201, 409]);
  assert.equal(await prisma.device.count({ where: { siteId: ids.siteA, managementIp: '10.250.1.84' } }), 1);

  const sharedCredential = { version: 'V3', username: 'http-shared-read', authKey: 'http-shared-auth-key', privKey: 'http-shared-priv-key' };
  const credentialRace = await Promise.all([
    request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', { ...duplicateIpPayload, name: 'HTTP Credential A', managementIp: '10.250.1.85', readCredential: sharedCredential }),
    request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', { ...duplicateIpPayload, name: 'HTTP Credential B', managementIp: '10.250.1.86', readCredential: sharedCredential }),
  ]);
  assert.deepEqual(credentialRace.map((response) => response.statusCode).sort(), [201, 409]);
  assert.equal(await prisma.device.count({ where: { siteId: ids.siteA, managementIp: { in: ['10.250.1.85', '10.250.1.86'] } } }), 1);

  const rackRace = await Promise.all([
    request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', { ...duplicateIpPayload, name: 'HTTP Rack A', managementIp: '10.250.1.87', rackId: ids.rackA, rackUnitStart: 25, rackUnitSize: 1, readCredential: { version: 'V3', username: 'http-rack-a', authKey: 'http-rack-a-auth', privKey: 'http-rack-a-priv' } }),
    request('POST', '/api/v1/snmp/onboarding/devices', 'qa-admin', { ...duplicateIpPayload, name: 'HTTP Rack B', managementIp: '10.250.1.88', rackId: ids.rackA, rackUnitStart: 25, rackUnitSize: 1, readCredential: { version: 'V3', username: 'http-rack-b', authKey: 'http-rack-b-auth', privKey: 'http-rack-b-priv' } }),
  ]);
  assert.deepEqual(rackRace.map((response) => response.statusCode).sort(), [201, 409]);
  assert.equal(await prisma.device.count({ where: { rackId: ids.rackA, rackUnitStart: 25 } }), 1);
});

test('applies room replacement ACLs without exposing sibling rooms', async () => {
  const buildings = await request('GET', `/api/v1/sites/${ids.siteA}/buildings`, 'qa-systems-scoped');
  assert.equal(buildings.statusCode, 200);
  assert.deepEqual(json(buildings)[0].rooms.map((room: { id: string }) => room.id), [ids.roomA]);
  const effective = await request('GET', `/api/v1/access/effective?siteId=${ids.siteA}`, 'qa-systems-scoped');
  assert.equal(effective.statusCode, 200);
  assert.deepEqual(json(effective).infrastructure.rooms.map((room: { id: string }) => room.id), [ids.roomA]);
  assert.equal((await request('POST', `/api/v1/buildings/${ids.buildingA}/rooms`, 'qa-systems-scoped', { name: 'Denied room' })).statusCode, 403);
  assert.equal((await request('POST', '/api/v1/racks', 'qa-systems-scoped', { name: 'Denied rack', roomId: ids.roomA })).statusCode, 403);
  assert.equal((await request('POST', '/api/v1/racks', 'qa-systems-scoped', { name: 'Hidden rack', roomId: ids.roomSibling })).statusCode, 404);
});

test('requires access to every subnet before mutating a multi-subnet Host', async () => {
  const response = await request('PATCH', `/api/v1/hosts/${ids.hostMulti}`, 'qa-network-scoped', { notes: 'must fail' });
  assert.equal(response.statusCode, 403);
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: ids.hostMulti } })).notes, null);
});

test('normalizes conflicts and records audited ADMIN mutations', async () => {
  const payload = { address: '10.250.1.30', subnetId: ids.subnetA, state: 'RESERVED', notes: 'HTTP integration' };
  const created = await request('POST', '/api/v1/ip-addresses', 'qa-admin', payload);
  assert.equal(created.statusCode, 201);
  const duplicate = await request('POST', '/api/v1/ip-addresses', 'qa-admin', payload);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(json(duplicate).code, 'IP_CONFLICT');
  assert.equal(await prisma.auditLog.count({ where: { action: 'IP_ADDRESS_CREATED', userId: ids.admin } }), 1);
});

test('protects the last ADMIN through the HTTP settings endpoint', async () => {
  const response = await request('PATCH', '/api/v1/settings/users/http-admin/roles', 'qa-admin', { roles: ['READ_ONLY'] });
  assert.equal(response.statusCode, 409);
  assert.equal(json(response).code, 'LAST_ADMIN_REQUIRED');
});

test('allows self-service role requests but reserves decisions for ADMIN', async () => {
  const submitted = await request('POST', '/api/v1/settings/role-requests', 'qa-readonly', { roles: ['AUDITOR', 'NETWORK_OPERATOR'] });
  assert.equal(submitted.statusCode, 201);
  const roleRequest = json(submitted) as { id: string; status: string };
  assert.equal(roleRequest.status, 'PENDING');

  const duplicate = await request('POST', '/api/v1/settings/role-requests', 'qa-readonly', { roles: ['SYSTEMS_OPERATOR'] });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(json(duplicate).code, 'ROLE_REQUEST_PENDING');
  assert.equal((await request('PATCH', `/api/v1/settings/role-requests/${roleRequest.id}`, 'qa-readonly', { decision: 'APPROVE' })).statusCode, 403);

  const approved = await request('PATCH', `/api/v1/settings/role-requests/${roleRequest.id}`, 'qa-admin', { decision: 'APPROVE' });
  assert.equal(approved.statusCode, 200);
  assert.equal(json(approved).status, 'APPROVED');
  const notification = await prisma.notification.findFirstOrThrow({ where: { userId: ids.readonly, roleRequestId: roleRequest.id } });
  assert.equal(notification.readAt, null);
  assert.equal(await prisma.auditLog.count({ where: { action: 'ROLE_REQUEST_APPROVED', entityId: roleRequest.id } }), 1);
  assert.equal((await request('PATCH', '/api/v1/dashboard/notifications/read-all', 'qa-readonly')).statusCode, 200);
  assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt);
});

test('approves Discovery idempotently without duplicating inventory or audit', async () => {
  const [first, second] = await Promise.all([
    request('POST', `/api/v1/discovery/results/${ids.discoveryResult}/review`, 'qa-network-scoped', { status: 'APPROVED' }),
    request('POST', `/api/v1/discovery/results/${ids.discoveryResult}/review`, 'qa-network-scoped', { status: 'APPROVED' }),
  ]);
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  const third = await request('POST', `/api/v1/discovery/results/${ids.discoveryResult}/review`, 'qa-network-scoped', { status: 'APPROVED' });
  assert.equal(third.statusCode, 201);
  const host = await prisma.host.findUniqueOrThrow({ where: { id: ids.hostManual }, include: { services: true, ipAddresses: true } });
  assert.equal(host.name, 'HTTP Manual Host');
  assert.equal(host.hostname, 'manual.example');
  assert.equal(host.status, 'ACTIVE');
  assert.equal(host.notes, 'preserve-me');
  assert.equal(host.observedHostname, 'observed.example');
  assert.equal(host.ipAddresses.length, 1);
  assert.deepEqual(host.services.map((service) => service.port).sort((a, b) => Number(a) - Number(b)), [22, 80, 443]);
  assert.equal(host.services.find((service) => service.port === 80)?.notes, 'preserve-service');
  assert.equal(await prisma.auditLog.count({ where: { action: 'DISCOVERY_RESULT_APPROVED', entityId: ids.discoveryResult } }), 1);
});
