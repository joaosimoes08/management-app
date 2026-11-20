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
  rackSibling: '91500000-0000-4000-8000-000000000002',
  deviceA: '92000000-0000-4000-8000-000000000001',
  deviceA2: '92000000-0000-4000-8000-000000000003',
  deviceB: '92000000-0000-4000-8000-000000000002',
  deviceSibling: '92000000-0000-4000-8000-000000000004',
  interfaceA: '92500000-0000-4000-8000-000000000001',
  interfaceA2: '92500000-0000-4000-8000-000000000002',
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
  await prisma.rack.create({ data: { id: ids.rackSibling, name: 'HTTP Rack Hidden', roomId: ids.roomSibling } });
  await prisma.device.createMany({ data: [
    { id: ids.deviceA, name: 'HTTP Switch A', type: 'SWITCH', managementIp: '10.250.1.2', siteId: ids.siteA, rackId: ids.rackA },
    { id: ids.deviceA2, name: 'HTTP Switch A2', type: 'SWITCH', managementIp: '10.250.1.3', siteId: ids.siteA, rackId: ids.rackA },
    { id: ids.deviceSibling, name: 'HTTP Hidden Switch', type: 'SWITCH', managementIp: '10.250.1.4', siteId: ids.siteA, rackId: ids.rackSibling },
    { id: ids.deviceB, name: 'HTTP Switch B', type: 'SWITCH', managementIp: '10.250.2.2', siteId: ids.siteB },
  ] });
  await prisma.deviceInterface.createMany({ data: [
    { id: ids.interfaceA, deviceId: ids.deviceA, name: 'Gi1/0/1', mode: 'TRUNK' },
    { id: ids.interfaceA2, deviceId: ids.deviceA2, name: 'Gi1/0/1', mode: 'TRUNK' },
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
  await prisma.interfaceVlan.create({ data: { interfaceId: ids.interfaceA, vlanId: ids.vlanA, tagged: true } });
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

test('requires a current planned-change impact preview before review submission', async () => {
  await prisma.deviceConnection.create({ data: { siteId: ids.siteA, type: 'PHYSICAL', source: 'SNMP', sourceDeviceId: ids.deviceA2, targetDeviceId: ids.deviceSibling, label: 'Unrelated observed link' } });
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const payload = {
    siteId: ids.siteA,
    title: 'HTTP planned change',
    reason: 'Validate the change review workflow.',
    plannedStartAt: start.toISOString(),
    plannedEndAt: end.toISOString(),
    items: [{ entityType: 'DEVICE', entityId: ids.deviceA, operationSummary: 'Upgrade firmware', currentValue: { version: '9.3.7' }, proposedValue: { version: '9.4.2' } }],
  };
  assert.equal((await request('POST', '/api/v1/change-plans', 'qa-readonly', payload)).statusCode, 403);
  const created = await request('POST', '/api/v1/change-plans', 'qa-admin', payload);
  assert.equal(created.statusCode, 201, created.body);
  const id = json(created).id as string;
  const withoutPreview = await request('POST', `/api/v1/change-plans/${id}/submit`, 'qa-admin');
  assert.equal(withoutPreview.statusCode, 409);
  assert.equal(json(withoutPreview).code, 'CHANGE_PLAN_PREVIEW_REQUIRED');

  const preview = await request('POST', `/api/v1/change-plans/${id}/impact-preview`, 'qa-admin', {});
  assert.equal(preview.statusCode, 201, preview.body);
  assert.equal(json(preview).analysisStatus, 'COMPLETE');
  assert.ok(Array.isArray(json(preview).knownImpacts));
  assert.ok(json(preview).coverage.reason);

  const edited = await request('PATCH', `/api/v1/change-plans/${id}`, 'qa-admin', { expectedRevision: 1, title: 'HTTP planned change updated' });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(json(edited).revision, 2);
  assert.equal(json(edited).previewRevision, null);
  const afterEdit = await request('POST', `/api/v1/change-plans/${id}/submit`, 'qa-admin');
  assert.equal(json(afterEdit).code, 'CHANGE_PLAN_PREVIEW_REQUIRED');

  const refreshedPreview = await request('POST', `/api/v1/change-plans/${id}/impact-preview`, 'qa-admin', {});
  assert.equal(refreshedPreview.statusCode, 201, refreshedPreview.body);
  await prisma.device.update({ where: { id: ids.deviceA }, data: { notes: 'Inventory changed after impact preview.' } });
  const stalePreview = await request('POST', `/api/v1/change-plans/${id}/submit`, 'qa-admin');
  assert.equal(stalePreview.statusCode, 409);
  assert.equal(json(stalePreview).code, 'CHANGE_PLAN_PREVIEW_STALE');
  const finalPreview = await request('POST', `/api/v1/change-plans/${id}/impact-preview`, 'qa-admin', {});
  assert.equal(finalPreview.statusCode, 201, finalPreview.body);
  await prisma.deviceConnection.create({ data: { siteId: ids.siteA, type: 'PHYSICAL', source: 'SNMP', sourceDeviceId: ids.deviceA2, targetDeviceId: ids.deviceSibling, label: 'Unrelated link added after preview' } });

  const submitted = await request('POST', `/api/v1/change-plans/${id}/submit`, 'qa-admin');
  assert.equal(submitted.statusCode, 201, submitted.body);
  assert.equal(json(submitted).status, 'SUBMITTED');
  const reviewed = await request('POST', `/api/v1/change-plans/${id}/review`, 'qa-admin', { status: 'APPROVED', reviewNote: 'Reviewed.' });
  assert.equal(reviewed.statusCode, 201, reviewed.body);
  assert.equal(json(reviewed).status, 'APPROVED');

  await prisma.deviceConnection.create({ data: { siteId: ids.siteA, type: 'PHYSICAL', source: 'SNMP', sourceDeviceId: ids.deviceA, targetDeviceId: ids.deviceA2, label: 'Impacted observed link' } });
  const impactedPlan = await request('POST', '/api/v1/change-plans', 'qa-admin', { ...payload, title: 'HTTP change with low-confidence impact' });
  assert.equal(impactedPlan.statusCode, 201, impactedPlan.body);
  const impactedId = json(impactedPlan).id as string;
  const impactedPreview = await request('POST', `/api/v1/change-plans/${impactedId}/impact-preview`, 'qa-admin', {});
  assert.equal(impactedPreview.statusCode, 201, impactedPreview.body);
  assert.equal(json(impactedPreview).coverage.status, 'PARTIAL');
  assert.equal(json(impactedPreview).knownImpacts.some((item: { entityId: string; confidence: string }) => item.entityId === ids.deviceA2 && item.confidence === 'LOW'), true);
  const blocked = await request('POST', `/api/v1/change-plans/${impactedId}/submit`, 'qa-admin');
  assert.equal(blocked.statusCode, 409);
  assert.equal(json(blocked).code, 'CHANGE_PLAN_PREVIEW_INCOMPLETE');
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
  assert.equal((await request('POST', `/api/v1/snmp/write-requests/${json(preview).id}/execute`, 'qa-admin', { impactAcknowledged: true })).statusCode, 403);
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

test('enforces scoped operations, dashboard, topology and quality workflows', async () => {
  const alertA = await prisma.operationalAlert.create({ data: { dedupKey: 'http:site-a', source: 'HTTP_TEST', severity: 'HIGH', siteId: ids.siteA, title: 'Site A alert', detail: 'Visible in Site A' } });
  await prisma.operationalAlert.create({ data: { dedupKey: 'http:hidden-device', source: 'HTTP_TEST', severity: 'HIGH', siteId: ids.siteA, entityType: 'Device', entityId: ids.deviceSibling, title: 'Hidden device alert', detail: 'Must stay inside the sibling room scope' } });
  await prisma.operationalAlert.create({ data: { dedupKey: 'http:site-b', source: 'HTTP_TEST', severity: 'CRITICAL', siteId: ids.siteB, title: 'Site B alert', detail: 'Hidden from Site A' } });
  const scopedAlerts = await request('GET', '/api/v1/operations/alerts', 'qa-network-scoped');
  assert.equal(scopedAlerts.statusCode, 200);
  assert.ok(json(scopedAlerts).items.some((item: { id: string }) => item.id === alertA.id));
  assert.equal(json(scopedAlerts).items.some((item: { title: string }) => item.title === 'Site B alert'), false);
  assert.equal((await request('PATCH', `/api/v1/operations/alerts/${alertA.id}/acknowledge`, 'qa-auditor')).statusCode, 403);
  assert.equal((await request('PATCH', `/api/v1/operations/alerts/${alertA.id}/acknowledge`, 'qa-network-legacy')).statusCode, 404);
  assert.equal((await request('PATCH', `/api/v1/operations/alerts/${alertA.id}/acknowledge`, 'qa-network-scoped')).statusCode, 200);
  assert.equal((await request('GET', '/api/v1/operations/alerts', 'qa-readonly')).statusCode, 200);
  const readonlyAlerts = await request('GET', '/api/v1/operations/alerts', 'qa-readonly');
  assert.equal(json(readonlyAlerts).items.some((item: { title: string }) => item.title === 'Hidden device alert'), false);

  const workspaces = await request('GET', `/api/v1/dashboard/workspaces?siteId=${ids.siteA}`, 'qa-network-scoped');
  assert.equal(workspaces.statusCode, 200);
  assert.deepEqual(json(workspaces).items.map((item: { role: string }) => item.role), ['NETWORK_OPERATOR']);
  const layout = await request('GET', `/api/v1/dashboard/layout?siteId=${ids.siteA}&role=NETWORK_OPERATOR`, 'qa-network-scoped');
  assert.equal(layout.statusCode, 200, layout.body);
  const layoutBody = json(layout);
  assert.equal((await request('PUT', '/api/v1/dashboard/layout', 'qa-network-scoped', { ...layoutBody, widgets: layoutBody.widgets.slice(0, 2) })).statusCode, 200);
  assert.equal((await request('PUT', '/api/v1/dashboard/layout', 'qa-network-scoped', { ...layoutBody, role: 'SYSTEMS_OPERATOR' })).statusCode, 403);

  const mapResponse = await request('POST', '/api/v1/topology/maps', 'qa-network-scoped', { siteId: ids.siteA, name: 'HTTP Network Map', type: 'NETWORK' });
  assert.equal(mapResponse.statusCode, 201, mapResponse.body);
  const map = json(mapResponse);
  const mapList = await request('GET', `/api/v1/topology/maps?siteId=${ids.siteA}&type=NETWORK&search=HTTP&page=1&pageSize=10`, 'qa-network-scoped');
  assert.equal(mapList.statusCode, 200);
  assert.equal(json(mapList).total, 1);
  assert.equal(json(mapList).items[0].id, map.id);
  assert.equal((await request('PUT', `/api/v1/topology/maps/${map.id}/nodes`, 'qa-network-scoped', { revision: map.revision, nodes: [{ deviceId: ids.deviceA, x: 10, y: 20 }, { deviceId: ids.deviceA2, x: 200, y: 20 }] })).statusCode, 200);
  const refreshedMap = await request('GET', `/api/v1/topology/maps/${map.id}`, 'qa-readonly');
  assert.equal(refreshedMap.statusCode, 200);
  assert.deepEqual(json(refreshedMap).nodes.map((node: { deviceId: string }) => node.deviceId).sort(), [ids.deviceA, ids.deviceA2].sort());
  const mapRevision = json(refreshedMap).revision;
  const connection = await request('POST', `/api/v1/topology/maps/${map.id}/connections`, 'qa-network-scoped', { revision: mapRevision, sourceDeviceId: ids.deviceA, targetDeviceId: ids.deviceA2, sourceInterfaceId: ids.interfaceA, targetInterfaceId: ids.interfaceA2, type: 'PHYSICAL', label: 'Uplink' });
  assert.equal(connection.statusCode, 201, connection.body);
  assert.equal((await request('PUT', `/api/v1/topology/maps/${map.id}/nodes`, 'qa-network-scoped', { revision: mapRevision, nodes: [] })).statusCode, 409);
  const latestMap = await request('GET', `/api/v1/topology/maps/${map.id}`, 'qa-network-scoped');
  assert.equal(json(latestMap).connections[0].sourceInterfaceId, ids.interfaceA);
  assert.equal((await request('POST', `/api/v1/topology/maps/${map.id}/connections`, 'qa-network-scoped', { revision: json(latestMap).revision, sourceDeviceId: ids.deviceA2, targetDeviceId: ids.deviceA, sourceInterfaceId: ids.interfaceA })).statusCode, 404);
  assert.equal((await request('PUT', `/api/v1/topology/maps/${map.id}/nodes`, 'qa-network-scoped', { revision: json(latestMap).revision, nodes: [{ deviceId: ids.deviceB, x: 0, y: 0 }] })).statusCode, 404);
  const vlanMapResponse = await request('POST', '/api/v1/topology/maps', 'qa-network-scoped', { siteId: ids.siteA, name: 'HTTP VLAN Map', type: 'VLAN_SUBNET', filters: { vlanIds: [ids.vlanA] } });
  assert.equal(vlanMapResponse.statusCode, 201, vlanMapResponse.body);
  const vlanMap = json(vlanMapResponse);
  assert.equal((await request('PUT', `/api/v1/topology/maps/${vlanMap.id}/nodes`, 'qa-network-scoped', { revision: vlanMap.revision, nodes: [{ deviceId: ids.deviceA, x: 10, y: 20 }, { deviceId: ids.deviceA2, x: 200, y: 20 }] })).statusCode, 200);
  const filteredVlanMap = await request('GET', `/api/v1/topology/maps/${vlanMap.id}`, 'qa-network-scoped');
  assert.deepEqual(json(filteredVlanMap).nodes.map((node: { deviceId: string }) => node.deviceId), [ids.deviceA]);
  assert.equal(json(filteredVlanMap).nodes[0].networkContext.vlans[0].vlanId, 2501);
  assert.equal((await request('POST', '/api/v1/topology/maps', 'qa-readonly', { siteId: ids.siteA, name: 'Denied', type: 'NETWORK' })).statusCode, 403);

  const reconciled = await request('POST', '/api/v1/inventory-quality/reconcile', 'qa-admin', { siteId: ids.siteA });
  assert.equal(reconciled.statusCode, 201, reconciled.body);
  const findings = await request('GET', `/api/v1/inventory-quality/findings?siteId=${ids.siteA}`, 'qa-auditor');
  assert.equal(findings.statusCode, 200);
  assert.ok(json(findings).items.length > 0);
  assert.equal(findings.body.includes('HTTP Hidden Switch'), false);
  const findingId = json(findings).items[0].id;
  assert.equal((await request('PATCH', `/api/v1/inventory-quality/findings/${findingId}/acknowledge`, 'qa-auditor')).statusCode, 403);
  assert.equal((await request('PATCH', `/api/v1/inventory-quality/findings/${findingId}/assign`, 'qa-network-scoped', { userId: ids.scoped })).statusCode, 200);
});

test('rack PDU power: defaults, allocation, 409s, cascades, audit, RBAC and wattage over HTTP', async () => {
  await resetDatabase();
  const admin = 'qa-admin';
  const conflict = (response: { statusCode: number; body: string }, code: string) => { assert.equal(response.statusCode, 409, response.body); assert.equal(json(response).code, code); return json(response); };

  // Defaults endpoint
  const defaults = await request('GET', '/api/v1/power/defaults', admin);
  assert.equal(defaults.statusCode, 200);
  assert.deepEqual([json(defaults).pduOutletCount, json(defaults).pduBudgetWatts, json(defaults).powerPlugCount, json(defaults).wattsByDeviceType.SERVER], [32, 3680, 2, 350]);

  // New rack: Só rede by default (one 32-outlet SUPPLIER PDU), Rede + UPS adds a UPS PDU
  const plain = await request('POST', '/api/v1/racks', admin, { name: 'Power Plain', roomId: ids.roomA });
  assert.equal(plain.statusCode, 201, plain.body);
  const plainRack = json(await request('GET', `/api/v1/racks/${json(plain).id}`, admin));
  assert.equal(plainRack.powerMode, 'SUPPLIER_ONLY');
  assert.deepEqual(plainRack.pdus.map((p: any) => [p.source, p.outletCount, p.budgetWatts]), [['SUPPLIER', 32, 3680]]);
  const dual = await request('POST', '/api/v1/racks', admin, { name: 'Power Dual', roomId: ids.roomA, powerMode: 'SUPPLIER_AND_UPS' });
  assert.equal(dual.statusCode, 201, dual.body);
  const rackId = json(dual).id;
  let rack = json(await request('GET', `/api/v1/racks/${rackId}`, admin));
  assert.equal(rack.powerMode, 'SUPPLIER_AND_UPS');
  assert.deepEqual(rack.pdus.map((p: any) => p.source), ['SUPPLIER', 'UPS']);
  const [supplierId, upsId] = rack.pdus.map((p: any) => p.id);

  // Devices: manual watts, model watts, type default
  const model = await prisma.deviceModel.create({ data: { manufacturer: 'QA', model: 'SW-120', type: 'SWITCH', typicalWatts: 120 } });
  const dev = { srv: '94000000-0000-4000-8000-000000000001', sw: '94000000-0000-4000-8000-000000000002', fw: '94000000-0000-4000-8000-000000000003' };
  await prisma.device.createMany({ data: [
    { id: dev.srv, name: 'PWR Server', type: 'SERVER', siteId: ids.siteA, rackId, estimatedWatts: 400 },
    { id: dev.sw, name: 'PWR Switch', type: 'SWITCH', siteId: ids.siteA, rackId, modelId: model.id },
    { id: dev.fw, name: 'PWR Firewall', type: 'FIREWALL', siteId: ids.siteA, rackId },
  ] });
  for (const id of [dev.srv, dev.sw, dev.fw]) {
    const response = await request('PUT', `/api/v1/devices/${id}/power`, admin, {});
    assert.equal(response.statusCode, 200, response.body);
    const body = json(response);
    assert.equal(body.device.plugCount, 2);
    assert.deepEqual(body.device.assignments.map((a: any) => a.source), ['SUPPLIER', 'UPS']);
    assert.equal(body.device.redundant, true);
  }
  rack = json(await request('GET', `/api/v1/racks/${rackId}`, admin));
  const supplier = rack.pdus.find((p: any) => p.source === 'SUPPLIER');
  assert.deepEqual(Object.fromEntries(supplier.connections.map((c: any) => [c.deviceName, [c.wattsSource, c.deviceEstimatedWatts, c.estimatedWattsShare, c.outlets.map((o: any) => o.outletIndex)]])), {
    'PWR Server': ['manual', 400, 200, [1]], 'PWR Switch': ['modelo', 120, 60, [2]], 'PWR Firewall': ['padrão', 200, 100, [3]],
  });
  assert.deepEqual([supplier.usedOutlets, supplier.estimatedWatts, supplier.failoverWatts], [3, 360, 720]);
  assert.deepEqual(rack.power.totals.bySource, { SUPPLIER: 360, UPS: 360 });
  assert.equal(rack.power.totals.estimatedWatts, 720);

  // Double-booked outlet → 409, nothing changed
  conflict(await request('PUT', `/api/v1/devices/${dev.fw}/power`, admin, { plugs: [{ plugIndex: 1, pduId: supplierId, outletIndex: 1 }] }), 'PDU_OUTLET_TAKEN');
  assert.equal(await prisma.pduOutletAssignment.count({ where: { deviceId: dev.fw } }), 2);

  // Shrinking below used outlets / removing a connected UPS → 409 with the device list
  const shrink = conflict(await request('PUT', `/api/v1/racks/${rackId}/pdus`, admin, { mode: 'SUPPLIER_AND_UPS', supplier: { outletCount: 2 } }), 'PDU_OUTLETS_IN_USE');
  assert.deepEqual(shrink.details.devices.map((d: any) => [d.deviceName, d.outlets]), [['PWR Firewall', [3]]]);
  const removeUps = conflict(await request('PUT', `/api/v1/racks/${rackId}/pdus`, admin, { mode: 'SUPPLIER_ONLY' }), 'PDU_HAS_CONNECTIONS');
  assert.deepEqual(removeUps.details.devices.map((d: any) => d.deviceName).sort(), ['PWR Firewall', 'PWR Server', 'PWR Switch']);
  assert.equal(await prisma.rackPdu.count({ where: { rackId } }), 2);

  // Read-only and scope-limited users get 403 on every write; network operator is blocked by role even for a SWITCH
  for (const persona of ['qa-readonly', 'qa-auditor', 'qa-systems-scoped', 'qa-network-scoped']) {
    assert.equal((await request('PUT', `/api/v1/devices/${dev.sw}/power`, persona, {})).statusCode, 403, persona);
    assert.equal((await request('PUT', `/api/v1/racks/${rackId}/pdus`, persona, { mode: 'SUPPLIER_AND_UPS' })).statusCode, 403, persona);
    assert.equal((await request('DELETE', `/api/v1/racks/${rackId}/pdus/${upsId}/devices/${dev.srv}`, persona)).statusCode, 403, persona);
    assert.equal((await request('DELETE', `/api/v1/racks/${rackId}/pdus/${upsId}/devices/${dev.sw}`, persona)).statusCode, 403, persona);
  }
  assert.equal(await prisma.pduOutletAssignment.count({ where: { pduId: upsId } }), 3);

  // Desligar frees only that PDU's outlets
  const off = await request('DELETE', `/api/v1/racks/${rackId}/pdus/${upsId}/devices/${dev.srv}`, admin);
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(json(off).removed, 1);
  assert.equal(json(off).pdus.find((p: any) => p.source === 'UPS').usedOutlets, 2);
  assert.deepEqual((await prisma.pduOutletAssignment.findMany({ where: { deviceId: dev.srv } })).map((a) => a.pduId), [supplierId]);

  // Moving a powered device to another rack without outlets would clear its power config → 400, nothing changed
  const moveBody = { name: 'PWR Switch', type: 'SWITCH', siteId: ids.siteA, rackId: json(plain).id, rackUnitStart: 1, rackUnitSize: 1 };
  const refused = await request('PATCH', `/api/v1/devices/${dev.sw}`, admin, moveBody);
  assert.equal(refused.statusCode, 400, refused.body);
  assert.equal(json(refused).code, 'REQUIRED_CONFIG_MISSING');
  assert.deepEqual(json(refused).details.errors.map((e: any) => [e.config, e.reason, e.tab]), [['power', 'CLEARED', 'energia']]);
  assert.equal((await prisma.device.findUnique({ where: { id: dev.sw } }))?.rackId, rackId);
  assert.equal(await prisma.pduOutletAssignment.count({ where: { deviceId: dev.sw } }), 2);
  // Moving with `power` frees the old outlets and plugs into the new rack in one transaction
  const moved = await request('PATCH', `/api/v1/devices/${dev.sw}`, admin, { ...moveBody, power: {} });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual(json(moved).requiredConfig.missing, ['rearImage']);
  const plainPduIds = (await prisma.rackPdu.findMany({ where: { rackId: json(plain).id } })).map((p) => p.id);
  const swOutlets = await prisma.pduOutletAssignment.findMany({ where: { deviceId: dev.sw } });
  assert.ok(swOutlets.length > 0 && swOutlets.every((a) => plainPduIds.includes(a.pduId)));
  // HTTP delete is gated by the retirement checklist (409); the hard delete itself cascades in the database
  assert.equal((await request('DELETE', `/api/v1/devices/${dev.fw}`, admin)).statusCode, 409);
  assert.equal(await prisma.pduOutletAssignment.count({ where: { deviceId: dev.fw } }), 2);
  await prisma.device.delete({ where: { id: dev.fw } });
  assert.equal(await prisma.pduOutletAssignment.count({ where: { deviceId: dev.fw } }), 0);

  // With the UPS empty it can now be removed
  for (const device of [dev.srv]) await request('DELETE', `/api/v1/racks/${rackId}/pdus/${upsId}/devices/${device}`, admin);
  const removed = await request('PUT', `/api/v1/racks/${rackId}/pdus`, admin, { mode: 'SUPPLIER_ONLY' });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(json(removed).mode, 'SUPPLIER_ONLY');

  // Every write is audited
  const actions = (await prisma.auditLog.findMany({ where: { userId: ids.admin, action: { in: ['DEVICE_POWER_UPDATED', 'DEVICE_POWER_DISCONNECTED', 'RACK_POWER_UPDATED'] } }, select: { action: true } })).map((a) => a.action);
  assert.equal(actions.filter((a) => a === 'DEVICE_POWER_UPDATED').length, 3);
  assert.equal(actions.filter((a) => a === 'DEVICE_POWER_DISCONNECTED').length, 1);
  assert.equal(actions.filter((a) => a === 'RACK_POWER_UPDATED').length, 1);
  const moveAudit = await prisma.auditLog.findFirst({ where: { entityId: dev.sw, action: { contains: 'UPDATED' }, NOT: { action: 'DEVICE_POWER_UPDATED' } }, orderBy: { createdAt: 'desc' } });
  assert.equal((moveAudit?.metadata as any)?.powerAssignmentsRemoved, 2);
});

test('required device configs: registry, create validation, legacy updates, grouped bell alerts and affected devices', async () => {
  const admin = 'qa-admin';
  const registry = json(await request('GET', '/api/v1/devices/required-configs', 'qa-readonly'));
  assert.deepEqual(registry.configs.map((c: any) => [c.key, c.kind, c.tab]), [['name', 'CORE', 'geral'], ['type', 'CORE', 'geral'], ['placement', 'CORE', 'localizacao'], ['rearImage', 'FEATURE', 'imagens'], ['power', 'FEATURE', 'energia']]);

  const rack = json(await request('POST', '/api/v1/racks', admin, { name: 'Required Config Rack', roomId: ids.roomA }));
  const base = { name: 'RC Server', type: 'SERVER', siteId: ids.siteA, rackId: rack.id, rackUnitStart: 10, rackUnitSize: 1 };

  // Create: every missing config comes back with field-level details; nothing is written
  const rejected = await request('POST', '/api/v1/devices', admin, base);
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(json(rejected).code, 'REQUIRED_CONFIG_MISSING');
  assert.deepEqual(json(rejected).details.errors.map((e: any) => [e.config, e.reason, e.tab, e.fields]), [['rearImage', 'MISSING', 'imagens', ['backAssetId']], ['power', 'MISSING', 'energia', ['power', 'powerPlugCount']]]);
  const noName = await request('POST', '/api/v1/devices', admin, { ...base, name: '', powerPlugCount: 0 });
  assert.equal(noName.statusCode, 400);
  assert.equal(await prisma.device.count({ where: { name: 'RC Server' } }), 0);

  // A device with no power (0 plugs) only needs the rear image; with `power: {}` it is plugged in on create
  const unpowered = await request('POST', '/api/v1/devices', admin, { ...base, name: 'RC Patch', type: 'OTHER', powerPlugCount: 0, rackUnitStart: 11 });
  assert.equal(unpowered.statusCode, 400);
  assert.deepEqual(json(unpowered).details.errors.map((e: any) => e.config), ['rearImage']);

  // The model's rear image counts, and `power: {}` plugs the device in during create (default distribution)
  const rear = await prisma.assetFile.create({ data: { filename: 'rc-rear.png', storageKey: 'rc-rear.png', mimeType: 'image/png', sizeBytes: 1, kind: 'DEVICE_BACK' } });
  const rcModel = await prisma.deviceModel.create({ data: { manufacturer: 'QA', model: 'RC-1U', type: 'SERVER', backAssetId: rear.id } });
  const created = await request('POST', '/api/v1/devices', admin, { ...base, modelId: rcModel.id, power: {} });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(json(created).requiredConfig, { missing: [], missingTabs: [], complete: true });
  assert.ok(await prisma.pduOutletAssignment.count({ where: { deviceId: json(created).id } }) > 0);

  // Legacy device (written before the rule): may be saved while still missing configs, and shows in the bell
  const legacy = await prisma.device.create({ data: { name: 'RC Legacy', type: 'SERVER', siteId: ids.siteA, rackId: rack.id, rackUnitStart: 20, rackUnitSize: 1 } });
  const legacyDetail = json(await request('GET', `/api/v1/devices/${legacy.id}`, admin));
  assert.deepEqual(legacyDetail.requiredConfig, { missing: ['rearImage', 'power'], missingTabs: ['imagens', 'energia'], complete: false });
  const legacyUpdate = await request('PATCH', `/api/v1/devices/${legacy.id}`, admin, { name: 'RC Legacy 2', type: 'SERVER', siteId: ids.siteA, rackId: rack.id, rackUnitStart: 20, rackUnitSize: 1 });
  assert.equal(legacyUpdate.statusCode, 200, legacyUpdate.body);

  const listed = json(await request('GET', `/api/v1/devices/missing-config?config=power&siteId=${ids.siteA}&pageSize=100`, admin));
  const row = listed.items.find((d: any) => d.id === legacy.id);
  assert.equal(row.href, `/infraestrutura?siteId=${ids.siteA}&tab=devices&deviceId=${legacy.id}&settingsTab=energia`);
  assert.equal((await request('GET', '/api/v1/devices/missing-config?config=frontImage', admin)).statusCode, 400);
  const filtered = json(await request('GET', `/api/v1/devices?missingConfig=power&pageSize=100`, admin));
  assert.ok(filtered.items.some((d: any) => d.id === legacy.id));
  assert.ok(filtered.items.every((d: any) => d.requiredConfig.missing.includes('power')));

  const bell = async () => json(await request('GET', '/api/v1/dashboard/topbar-state', admin)).alerts.filter((a: any) => String(a.id).startsWith('device-missing-config-'));
  let alerts = await bell();
  const powerAlert = alerts.find((a: any) => a.id === 'device-missing-config-power');
  assert.equal(powerAlert.persistent, true);
  assert.equal(powerAlert.title.endsWith('sem tomadas de energia configuradas'), true);
  assert.equal(alerts.filter((a: any) => a.id === 'device-missing-config-power').length, 1);
  const powerCount = json(await request('GET', '/api/v1/devices/missing-config?config=power', admin)).total;
  assert.equal(powerAlert.count, powerCount);

  // Plugging the legacy device in auto-clears it from the group; clearing it again is refused
  const plugged = await request('PUT', `/api/v1/devices/${legacy.id}/power`, admin, {});
  assert.equal(plugged.statusCode, 200, plugged.body);
  const after = json(await request('GET', '/api/v1/devices/missing-config?config=power&pageSize=100', admin));
  assert.equal(after.total, powerCount - 1);
  assert.equal(after.items.some((d: any) => d.id === legacy.id), false);
  alerts = await bell();
  const afterAlert = alerts.find((a: any) => a.id === 'device-missing-config-power');
  if (powerCount - 1 === 0) assert.equal(afterAlert, undefined);
  else assert.ok(afterAlert.title.startsWith(`${powerCount - 1} dispositivo`), afterAlert.title);
  const cleared = await request('PUT', `/api/v1/devices/${legacy.id}/power`, admin, { plugs: [] });
  assert.equal(cleared.statusCode, 400, cleared.body);
  assert.deepEqual(json(cleared).details.errors.map((e: any) => [e.config, e.reason]), [['power', 'CLEARED']]);
  assert.ok(await prisma.pduOutletAssignment.count({ where: { deviceId: legacy.id } }) > 0);

  // Read-only users see no fix-it alerts
  assert.deepEqual(json(await request('GET', '/api/v1/dashboard/topbar-state', 'qa-readonly')).alerts.filter((a: any) => String(a.id).startsWith('device-missing-config-')), []);
});
