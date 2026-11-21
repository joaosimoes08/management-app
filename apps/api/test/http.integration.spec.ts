import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
    "Notification", "RoleRequest", "UserApplicationFavorite", "ApplicationLinkRole", "ApplicationLink", "RipeImport", "InfrastructurePermission", "AccessGroupSitePermission", "AccessGroupSite", "AccessGroupMember", "AccessGroup",
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
  // Any IANA time zone is accepted for the organisation; unknown ones are a 400.
  const newYork = await request('PATCH', '/api/v1/settings/organization', 'qa-admin', { timezone: 'America/New_York' });
  assert.equal(newYork.statusCode, 200, newYork.body);
  assert.equal(json(newYork).timezone, 'America/New_York');
  assert.equal((await prisma.systemSettings.findFirstOrThrow()).timezone, 'America/New_York');
  const mars = await request('PATCH', '/api/v1/settings/organization', 'qa-admin', { timezone: 'Mars/Base' });
  assert.equal(mars.statusCode, 400, mars.body);
  assert.match(mars.body, /valid IANA time zone/);
  assert.equal((await request('PATCH', '/api/v1/settings/organization', 'qa-admin', { timezone: 'europe/lisbon' })).statusCode, 400);
  assert.equal((await request('PATCH', '/api/v1/settings/organization', 'qa-admin', { timezone: 'EUROPE/LISBON' })).statusCode, 400);
  assert.equal((await prisma.systemSettings.findFirstOrThrow()).timezone, 'America/New_York');
  assert.equal((await request('PATCH', '/api/v1/settings/organization', 'qa-admin', { timezone: 'Asia/Kolkata' })).statusCode, 200);
  assert.equal((await prisma.systemSettings.findFirstOrThrow()).timezone, 'Asia/Kolkata');
  assert.equal((await request('PATCH', '/api/v1/settings/organization', 'qa-admin', { timezone: 'Europe/Lisbon' })).statusCode, 200);
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

test('critical asset attestation: 409 on a second review of the same cycle, reviewer names and due state over HTTP', async () => {
  await prisma.user.update({ where: { id: ids.admin }, data: { displayName: 'QA Admin Person' } });
  await prisma.device.updateMany({ where: { id: { in: [ids.deviceA, ids.deviceA2] } }, data: { isCritical: true } });
  await prisma.criticalAssetGroupMapping.create({ data: { siteId: ids.siteA, assetType: 'SWITCH', groupId: ids.groupRead } });
  const pending = await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA, weekStart: new Date('2026-11-09T00:00:00.000Z') } });
  for (const week of ['2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05']) {
    await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA, weekStart: new Date(`${week}T00:00:00.000Z`), outcome: 'CONFIRMED', confirmedAt: new Date(`${week}T10:00:00.000Z`), confirmedBy: ids.scoped, notes: week === '2026-10-26' ? 'checked tag' : null } });
  }
  const first = await request('POST', `/api/v1/critical-assets/${pending.id}/confirm`, 'qa-admin', { outcome: 'CORRECTION_NEEDED', notes: 'Wrong serial' });
  assert.equal(first.statusCode, 201);
  assert.equal(json(first).confirmedByName, 'QA Admin Person');
  assert.equal(json(first).confirmedBy, ids.admin);
  const second = await request('POST', `/api/v1/critical-assets/${pending.id}/confirm`, 'qa-admin', { outcome: 'CONFIRMED' });
  assert.equal(second.statusCode, 409);
  const conflict = json(second);
  assert.equal(conflict.code, 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED');
  assert.match(conflict.message, /já foi registada por QA Admin Person/);
  assert.equal(conflict.details.outcome, 'CORRECTION_NEEDED');
  assert.equal(conflict.details.weekStart, '2026-11-09');
  const stored = await prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(stored.outcome, 'CORRECTION_NEEDED');
  assert.equal(stored.notes, 'Wrong serial');
  assert.equal(await prisma.auditLog.count({ where: { action: 'CRITICAL_ASSET_ATTESTATION_RECORDED', entityId: ids.deviceA } }), 1);

  const list = await request('GET', `/api/v1/critical-assets?siteId=${ids.siteA}`, 'qa-admin');
  assert.equal(list.statusCode, 200);
  const body = json(list);
  const switchA = body.assets.find((asset: { id: string }) => asset.id === ids.deviceA);
  assert.equal(switchA.attestations.length, 6);
  assert.equal(switchA.owner.id, ids.groupRead);
  assert.equal(switchA.latestOutcome, 'CORRECTION_NEEDED');
  assert.equal(switchA.dueState, 'up_to_date');
  assert.equal(switchA.attestations[0].confirmedByName, 'QA Admin Person');
  assert.equal(switchA.attestations[1].confirmedByName, 'qa-network-scoped');
  assert.equal(switchA.attestations.find((row: { notes: string | null }) => row.notes === 'checked tag')?.weekStart.slice(0, 10), '2026-10-26');
  const switchA2 = body.assets.find((asset: { id: string }) => asset.id === ids.deviceA2);
  assert.equal(switchA2.dueState, 'unscheduled');
  assert.equal(typeof switchA2.dueDate, 'string');
});

test('critical asset attestation: two simultaneous reviews of one cycle give exactly one 201 and one 409', async () => {
  await prisma.device.update({ where: { id: ids.deviceA2 }, data: { isCritical: true } });
  await prisma.criticalAssetGroupMapping.upsert({ where: { siteId_assetType: { siteId: ids.siteA, assetType: 'SWITCH' } }, create: { siteId: ids.siteA, assetType: 'SWITCH', groupId: ids.groupRead }, update: {} });
  for (let round = 0; round < 5; round += 1) {
    const row = await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA2, weekStart: new Date(Date.UTC(2026, 5, 1 + round * 7)) } });
    const responses = await Promise.all([
      request('POST', `/api/v1/critical-assets/${row.id}/confirm`, 'qa-admin', { outcome: 'CONFIRMED', notes: 'first' }),
      request('POST', `/api/v1/critical-assets/${row.id}/confirm`, 'qa-admin', { outcome: 'CORRECTION_NEEDED', notes: 'second' }),
    ]);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [201, 409]);
    const winner = json(responses.find((response) => response.statusCode === 201)!);
    const loser = json(responses.find((response) => response.statusCode === 409)!);
    assert.equal(loser.code, 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED');
    const stored = await prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.outcome, winner.outcome);
    assert.equal(stored.notes, winner.notes);
    assert.equal(await prisma.auditLog.count({ where: { action: 'CRITICAL_ASSET_ATTESTATION_RECORDED', metadata: { path: ['attestationId'], equals: row.id } } }), 1);
  }
});
test('enforces the Site permission on every NAT write, whatever links the rule to the Site', async () => {
  const vrfA = await prisma.vrf.create({ data: { name: 'HTTP VRF A', siteId: ids.siteA } });
  const vrfB = await prisma.vrf.create({ data: { name: 'HTTP VRF B', siteId: ids.siteB } });
  const vrfOnlyA = await prisma.natRule.create({ data: { name: 'HTTP NAT VRF-only A', type: 'SNAT', vrfId: vrfA.id } });
  const siteOnlyA = await prisma.natRule.create({ data: { name: 'HTTP NAT Site-only A', type: 'DNAT', siteId: ids.siteA } });
  const vrfOnlyB = await prisma.natRule.create({ data: { name: 'HTTP NAT VRF-only B', type: 'SNAT', vrfId: vrfB.id } });
  const body = (extra: Record<string, unknown>) => ({ name: 'HTTP NAT edited', type: 'SNAT', ...extra });

  // Scoped operator: Site A READ/CREATE/UPDATE, no DELETE. These deletes used to succeed.
  const deniedVrfDelete = await request('DELETE', `/api/v1/nat-rules/${vrfOnlyA.id}`, 'qa-network-scoped');
  assert.equal(deniedVrfDelete.statusCode, 403, deniedVrfDelete.body);
  assert.equal(json(deniedVrfDelete).code, 'IPAM_SCOPE_FORBIDDEN');
  assert.equal((await request('DELETE', `/api/v1/nat-rules/${siteOnlyA.id}`, 'qa-network-scoped')).statusCode, 403);
  assert.ok(await prisma.natRule.findUnique({ where: { id: vrfOnlyA.id } }));
  assert.ok(await prisma.natRule.findUnique({ where: { id: siteOnlyA.id } }));
  assert.equal((await request('PATCH', `/api/v1/nat-rules/${vrfOnlyA.id}`, 'qa-network-scoped', body({}))).statusCode, 200);

  // A Site the user can read but not write: 403 on create, update, delete and on moving a rule there.
  await prisma.accessGroupSite.create({ data: { groupId: ids.groupRead, siteId: ids.siteB } });
  await prisma.accessGroupSitePermission.create({ data: { groupId: ids.groupRead, siteId: ids.siteB, permission: 'READ' } });
  try {
    assert.equal((await request('GET', `/api/v1/nat-rules/${vrfOnlyB.id}`, 'qa-network-scoped')).statusCode, 200);
    const deniedUpdate = await request('PATCH', `/api/v1/nat-rules/${vrfOnlyB.id}`, 'qa-network-scoped', body({}));
    assert.equal(deniedUpdate.statusCode, 403, deniedUpdate.body);
    assert.equal((await request('DELETE', `/api/v1/nat-rules/${vrfOnlyB.id}`, 'qa-network-scoped')).statusCode, 403);
    assert.equal((await request('POST', '/api/v1/nat-rules', 'qa-network-scoped', body({ vrfId: vrfB.id }))).statusCode, 403);
    assert.equal((await request('POST', '/api/v1/nat-rules', 'qa-network-scoped', body({ siteId: ids.siteB }))).statusCode, 403);
    assert.equal((await request('POST', '/api/v1/nat-rules', 'qa-network-scoped', body({ siteId: ids.siteA, translatedSubnetId: ids.subnetB }))).statusCode, 403);
    assert.equal((await request('PATCH', `/api/v1/nat-rules/${vrfOnlyA.id}`, 'qa-network-scoped', body({ vrfId: vrfB.id }))).statusCode, 403);
    assert.equal((await prisma.natRule.findUniqueOrThrow({ where: { id: vrfOnlyA.id } })).vrfId, vrfA.id);
  } finally {
    await prisma.accessGroupSitePermission.deleteMany({ where: { groupId: ids.groupRead, siteId: ids.siteB } });
    await prisma.accessGroupSite.deleteMany({ where: { groupId: ids.groupRead, siteId: ids.siteB } });
  }

  // Invisible Site stays a 404; an unscoped rule is refused for non-admins; allowed writes still work.
  assert.equal((await request('POST', '/api/v1/nat-rules', 'qa-network-scoped', body({ vrfId: vrfB.id }))).statusCode, 404);
  const unscoped = await request('POST', '/api/v1/nat-rules', 'qa-network-scoped', body({}));
  assert.equal(unscoped.statusCode, 403);
  assert.equal(json(unscoped).code, 'IPAM_NAT_SITE_REQUIRED');
  assert.equal((await request('POST', '/api/v1/nat-rules', 'qa-network-scoped', body({ vrfId: vrfA.id }))).statusCode, 201);
  assert.equal((await request('DELETE', `/api/v1/nat-rules/${vrfOnlyB.id}`, 'qa-admin')).statusCode, 200);
});

test('previews a pasted prefix list with a server-side diff and imports it through the same confirm flow', async () => {
  const vrfA = await prisma.vrf.create({ data: { name: 'HTTP RIPE VRF', siteId: ids.siteA } });
  await prisma.subnet.createMany({ data: [
    { cidr: '10.251.1.0/24', version: 4, siteId: ids.siteA, purpose: 'Users' },
    { cidr: '10.251.2.0/24', version: 4, siteId: ids.siteA, vrfId: vrfA.id },
    { cidr: '10.251.8.0/22', version: 4, siteId: ids.siteA },
  ] });
  const pasted = ['10.251.1.0/24\n10.251.2.0/24', '10.251.9.0/24, 10.250.2.0/24; 10.251.20.1/24', '2001:db8:251::/48', 'nope', '10.251.20.0/24'];
  const preview = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: pasted, siteId: ids.siteA, query: 'HTTP paste' });
  assert.equal(preview.statusCode, 201, preview.body);
  const result = json(preview);
  assert.equal(result.source, 'PASTE');
  assert.equal(result.queryType, 'paste');
  assert.equal(result.status, 'PREVIEW');
  assert.deepEqual(result.target, { siteId: ids.siteA, vrfId: null, purpose: null, environment: null });
  assert.deepEqual(result.prefixes, ['10.251.1.0/24', '10.251.2.0/24', '10.251.9.0/24', '10.250.2.0/24', '10.251.20.0/24', '2001:db8:251::/48']);
  const status = Object.fromEntries(result.diff.map((item: { prefix: string; status: string; reason: string }) => [item.prefix, `${item.status}:${item.reason}`]));
  assert.deepEqual(status, {
    '10.251.1.0/24': 'exists:EXISTS_SAME',
    '10.251.2.0/24': 'changed:EXISTS_DIFFERENT_ATTRIBUTES',
    '10.251.9.0/24': 'conflict:OVERLAP',
    '10.250.2.0/24': 'conflict:EXISTS_OUTSIDE_SITE',
    '10.251.20.0/24': 'new:NEW',
    '2001:db8:251::/48': 'new:NEW',
  });
  assert.deepEqual(result.summary, { total: 6, new: 2, changed: 1, exists: 1, conflict: 2, importable: 2, invalid: 1, duplicates: 1 });
  assert.deepEqual(result.invalid.map((item: { input: string }) => item.input), ['nope']);
  assert.deepEqual(result.normalized, [{ input: '10.251.20.1/24', prefix: '10.251.20.0/24' }]);
  const stored = await prisma.ripeImport.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(stored.source, 'PASTE');
  assert.equal(json(await request('GET', `/api/v1/ipam/ripe/imports/${result.id}`, 'qa-admin')).result.summary.new, 2);

  // Same confirm endpoint as RIPEstat previews; the target must match what was diffed.
  assert.equal(json(await request('POST', '/api/v1/ipam/ripe/import', 'qa-admin', { importId: result.id, prefixes: ['10.251.20.0/24'], siteId: ids.siteB })).code, 'RIPE_PREVIEW_TARGET_MISMATCH');
  assert.equal((await request('POST', '/api/v1/ipam/ripe/import', 'qa-admin', { importId: result.id, prefixes: ['10.251.20.0/24'], siteId: ids.siteA, vrfId: vrfA.id })).statusCode, 400);
  const imported = await request('POST', '/api/v1/ipam/ripe/import', 'qa-admin', { importId: result.id, prefixes: ['10.251.20.0/24', '2001:db8:251::/48', '10.251.1.0/24'], siteId: ids.siteA });
  assert.equal(imported.statusCode, 201, imported.body);
  assert.equal(json(imported).status, 'PARTIAL');
  assert.deepEqual(json(imported).created.map((item: { cidr: string }) => item.cidr).sort(), ['10.251.20.0/24', '2001:db8:251::/48']);
  assert.deepEqual(json(imported).skipped.map((item: { cidr: string }) => item.cidr), ['10.251.1.0/24']);

  // Validation and role gating.
  assert.equal((await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: ['10.251.30.0/24'] })).statusCode, 400);
  assert.equal((await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: [], siteId: ids.siteA })).statusCode, 400);
  const noneValid = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: ['garbage', '10.0.0.1'], siteId: ids.siteA });
  assert.equal(json(noneValid).code, 'RIPE_PASTE_NO_VALID_PREFIX');
  const tooMany = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: [Array.from({ length: 501 }, (_, index) => `10.252.${index >> 8}.${index & 255}/32`).join('\n')], siteId: ids.siteA });
  assert.equal(json(tooMany).code, 'RIPE_PASTE_TOO_MANY');
  assert.equal((await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: ['10.251.30.0/24'], siteId: ids.siteA, vrfId: (await prisma.vrf.create({ data: { name: 'HTTP RIPE VRF B', siteId: ids.siteB } })).id })).statusCode, 400);
  assert.equal((await request('POST', '/api/v1/ipam/ripe/preview', 'qa-readonly', { prefixes: ['10.251.30.0/24'], siteId: ids.siteA })).statusCode, 403);
  assert.equal((await request('POST', '/api/v1/ipam/ripe/preview', 'qa-network-scoped', { prefixes: ['10.251.30.0/24'], siteId: ids.siteA })).statusCode, 403);
  assert.equal((await request('POST', '/api/v1/ipam/ripe/preview', 'qa-network-scoped', { prefixes: ['10.251.30.0/24'], siteId: ids.siteB })).statusCode, 404);
});

test('keeps the RIPEstat lookup preview response unchanged and adds a diff only when a Site is given', async () => {
  // The stand-in serves real RIPEstat responses (test/fixtures, captured 2026-11-21) by data call.
  const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/data/announced-prefixes/')) return res.end(fixture('ripestat-announced-prefixes-AS3333.json'));
    if (req.url?.startsWith('/data/whois/') && req.url.includes('193.0.0.0')) return res.end(fixture('ripestat-whois-193.0.0.0-21.json'));
    res.statusCode = 400; res.end(fixture('ripestat-whois-unsupported.json'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const original = process.env.RIPESTAT_BASE_URL;
  process.env.RIPESTAT_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/data/`;
  const as3333 = ['193.0.12.0/23', '2001:67c:2e8::/48', '193.0.10.0/23', '193.0.18.0/23', '193.0.22.0/23', '193.0.20.0/23', '193.0.0.0/21', '2a13:27c0::/44'];
  try {
    const legacy = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { query: 'AS3333' });
    assert.equal(legacy.statusCode, 201, legacy.body);
    assert.deepEqual(Object.keys(json(legacy)).sort(), ['id', 'prefixes', 'query', 'queryType', 'status']);
    assert.deepEqual(json(legacy).prefixes, as3333);
    assert.match(calls[0], /announced-prefixes\/data\.json\?resource=AS3333$/);
    const withSite = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { query: 'AS3333', siteId: ids.siteA });
    assert.equal(withSite.statusCode, 201, withSite.body);
    assert.equal(json(withSite).source, 'RIPESTAT');
    assert.deepEqual(json(withSite).diff.map((item: { prefix: string }) => item.prefix), as3333);
    assert.deepEqual([...new Set(json(withSite).diff.map((item: { status: string }) => item.status))], ['new']);

    const whois = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { query: '193.0.0.0/21' });
    assert.equal(whois.statusCode, 201, whois.body);
    assert.equal(json(whois).queryType, 'prefix');
    assert.deepEqual(json(whois).prefixes, ['193.0.0.0/21']);

    const callsBefore = calls.length;
    const organisation = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { query: 'RIPE-NCC' });
    assert.equal(organisation.statusCode, 400);
    assert.equal(json(organisation).code, 'RIPE_ORGANISATION_UNSUPPORTED');
    assert.equal(calls.length, callsBefore, 'organisation lookups must not call RIPEstat');
    const unsupported = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { query: '10.9.9.9/32' });
    assert.equal(unsupported.statusCode, 400);
    assert.match(json(unsupported).message, /unsupported resource type/);
  } finally {
    if (original === undefined) delete process.env.RIPESTAT_BASE_URL; else process.env.RIPESTAT_BASE_URL = original;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('marks a prefix overlapping an earlier prefix of the same paste as a conflict', async () => {
  const preview = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: ['10.253.0.0/16\n10.253.1.0/24\n10.254.0.0/24'], siteId: ids.siteA });
  assert.equal(preview.statusCode, 201, preview.body);
  const result = json(preview);
  assert.deepEqual(result.diff.map((item: { prefix: string; status: string; importable: boolean }) => [item.prefix, item.status, item.importable]), [
    ['10.253.0.0/16', 'new', true],
    ['10.253.1.0/24', 'conflict', false],
    ['10.254.0.0/24', 'new', true],
  ]);
  assert.equal(result.diff[1].reason, 'OVERLAP');
  assert.deepEqual(result.diff[1].overlaps, [{ source: 'paste', relation: 'within', sameScope: true, prefix: '10.253.0.0/16' }]);
  assert.equal(result.summary.importable, 2);
  const imported = await request('POST', '/api/v1/ipam/ripe/import', 'qa-admin', { importId: result.id, prefixes: result.diff.filter((item: { importable: boolean }) => item.importable).map((item: { prefix: string }) => item.prefix), siteId: ids.siteA });
  assert.equal(imported.statusCode, 201, imported.body);
  assert.equal(json(imported).status, 'IMPORTED');
  assert.deepEqual(json(imported).skipped, []);
});

test('imports by the stored diff, not by the order the client sends the prefixes', async () => {
  const preview = await request('POST', '/api/v1/ipam/ripe/preview', 'qa-admin', { prefixes: ['10.252.0.0/16\n10.252.1.0/24'], siteId: ids.siteA });
  assert.equal(preview.statusCode, 201, preview.body);
  const result = json(preview);
  assert.deepEqual(result.diff.map((item: { prefix: string; status: string; importable: boolean }) => [item.prefix, item.status, item.importable]), [
    ['10.252.0.0/16', 'new', true],
    ['10.252.1.0/24', 'conflict', false],
  ]);
  // The /24 is sent first: it must still be skipped as OVERLAP and the /16 created.
  const imported = await request('POST', '/api/v1/ipam/ripe/import', 'qa-admin', { importId: result.id, prefixes: ['10.252.1.0/24', '10.252.0.0/16'], siteId: ids.siteA });
  assert.equal(imported.statusCode, 201, imported.body);
  assert.equal(json(imported).status, 'PARTIAL');
  assert.deepEqual(json(imported).created.map((item: { cidr: string }) => item.cidr), ['10.252.0.0/16']);
  assert.deepEqual(json(imported).skipped.map((item: { cidr: string; reason: string }) => [item.cidr, item.reason]), [['10.252.1.0/24', 'OVERLAP']]);
  assert.equal(await prisma.subnet.count({ where: { cidr: '10.252.1.0/24' } }), 0);
  const stored = await prisma.ripeImport.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(stored.status, 'PARTIAL');
});

test('Phase C audit: cursor paging past 200, exact filters, facets, diff and CSV export', async () => {
  const at = new Date('2030-01-01T00:00:00.000Z');
  // 205 events sharing one timestamp prove the id tie-breaker gives a stable, gap-free order past the old 200 cap.
  await prisma.auditLog.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ userId: ids.admin, action: 'PHASEC_PAGING', entityType: 'PhaseCTest', entityId: `row-${index}`, createdAt: at })) });
  await prisma.auditLog.create({ data: { userId: ids.auditor, action: 'AUDIT_RETENTION_UPDATED', entityType: 'SystemSettings', entityId: 'phase-c', metadata: { previousDays: 90, nextDays: 30 } } });
  await prisma.auditLog.create({ data: { userId: ids.admin, action: 'GET /api/v1/phase-c-noise', entityType: 'HTTP_REQUEST', metadata: { statusCode: 200 } } });

  const seen = new Set<string>(); let cursor: string | null = null; let pages = 0;
  do {
    const response = await request('GET', `/api/v1/audit/events/page?action=PHASEC_PAGING&limit=60${cursor ? `&cursor=${cursor}` : ''}`, 'qa-auditor');
    assert.equal(response.statusCode, 200, response.body);
    const body = json(response);
    for (const item of body.items) { assert.equal(seen.has(item.id), false, 'duplicate across pages'); seen.add(item.id); assert.equal(item.user.username, 'qa-admin'); }
    cursor = body.nextCursor; pages += 1;
    assert.equal(body.hasMore, cursor !== null);
  } while (cursor && pages < 10);
  assert.equal(seen.size, 205); assert.equal(pages, 4);

  // Exact match: a substring of the action does not match on the paged endpoint.
  assert.equal(json(await request('GET', '/api/v1/audit/events/page?action=PHASEC', 'qa-auditor')).items.length, 0);
  const byActor = json(await request('GET', `/api/v1/audit/events/page?actorId=${ids.auditor}&entityType=SystemSettings`, 'qa-admin'));
  assert.equal(byActor.items.length, 1);
  assert.deepEqual(byActor.items[0].diff, [{ field: 'days', before: 90, after: 30 }]);
  assert.equal(byActor.items[0].hasDiff, true);
  // (The interceptor logs each request URL, so filter by the exact action rather than free text here.)
  const noiseAction = encodeURIComponent('GET /api/v1/phase-c-noise');
  assert.equal(json(await request('GET', `/api/v1/audit/events/page?action=${noiseAction}&excludeHttp=true`, 'qa-admin')).items.length, 0);
  assert.equal(json(await request('GET', `/api/v1/audit/events/page?action=${noiseAction}`, 'qa-admin')).items.length, 1);
  assert.equal(json(await request('GET', '/api/v1/audit/events/page?entityType=PhaseCTest&entityId=row-7', 'qa-admin')).items.length, 1);

  assert.equal((await request('GET', '/api/v1/audit/events/page?cursor=garbage', 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', '/api/v1/audit/events/page?from=yesterday', 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', '/api/v1/audit/events/page', 'qa-readonly')).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/audit/facets', 'qa-network-scoped')).statusCode, 403);

  const facets = json(await request('GET', '/api/v1/audit/facets', 'qa-auditor'));
  assert.deepEqual(facets.actions.find((item: { value: string }) => item.value === 'PHASEC_PAGING'), { value: 'PHASEC_PAGING', count: 205 });
  assert.equal(facets.actions.some((item: { value: string }) => item.value.startsWith('GET ')), false);
  assert.ok(facets.entityTypes.some((item: { value: string }) => item.value === 'HTTP_REQUEST'));
  assert.ok(facets.actors.some((item: { id: string; username: string }) => item.id === ids.auditor && item.username === 'qa-auditor'));

  const csv = await request('GET', '/api/v1/audit/events/export?action=PHASEC_PAGING', 'qa-auditor');
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers['content-type']), /text\/csv/);
  assert.equal(csv.headers['x-export-row-count'], '205');
  assert.equal(csv.body.trim().split('\r\n').length, 206);

  // The legacy list keeps its array shape and 200 cap.
  const legacy = await request('GET', '/api/v1/audit/events?action=PHASEC&limit=500', 'qa-auditor');
  assert.equal(legacy.statusCode, 200);
  assert.ok(Array.isArray(json(legacy))); assert.equal(json(legacy).length, 200);
});

test('Phase C quality: bounded snooze, bulk actions with per-item permission and Site isolation, facets', async () => {
  const make = (key: string, rule: string, siteId: string, entityId: string) => prisma.inventoryFinding.create({ data: { dedupKey: `phase-c:${key}`, siteId, rule, severity: 'WARNING', entityType: 'Device', entityId, title: `Phase C ${key}`, detail: 'Phase C finding' } });
  const a1 = await make('a1', 'PHASEC_RULE_ONE', ids.siteA, ids.deviceA);
  const a2 = await make('a2', 'PHASEC_RULE_TWO', ids.siteA, ids.deviceA2);
  const hidden = await make('hidden', 'PHASEC_RULE_ONE', ids.siteA, ids.deviceSibling);
  const b1 = await make('b1', 'PHASEC_RULE_ONE', ids.siteB, ids.deviceB);
  const url = '/api/v1/inventory-quality/findings';

  // Single snooze: duration, legacy until, and bounds.
  const single = await request('PATCH', `${url}/${a1.id}/snooze`, 'qa-network-scoped', { durationHours: 2 });
  assert.equal(single.statusCode, 200, single.body);
  const delta = new Date(json(single).snoozedUntil).getTime() - Date.now();
  assert.ok(delta > 1.9 * 3_600_000 && delta <= 2 * 3_600_000, String(delta));
  assert.equal((await request('PATCH', `${url}/${a1.id}/snooze`, 'qa-network-scoped', { until: new Date(Date.now() + 24 * 3_600_000).toISOString() })).statusCode, 200);
  assert.equal((await request('PATCH', `${url}/${a1.id}/snooze`, 'qa-network-scoped', { until: new Date(Date.now() + 40 * 24 * 3_600_000).toISOString() })).statusCode, 400);
  assert.equal((await request('PATCH', `${url}/${a1.id}/snooze`, 'qa-network-scoped', { durationHours: 721 })).statusCode, 400);
  assert.equal((await request('PATCH', `${url}/${a1.id}/snooze`, 'qa-network-scoped', {})).statusCode, 400);

  // Bulk snooze: items in the operator's Site succeed, the other Site's item looks not-found.
  const bulk = await request('POST', `${url}/bulk`, 'qa-network-scoped', { action: 'SNOOZE', ids: [a1.id, a2.id, b1.id], durationHours: 72, reason: 'Phase C' });
  assert.equal(bulk.statusCode, 200, bulk.body);
  const bulkBody = json(bulk);
  assert.equal(bulkBody.succeeded, 2); assert.equal(bulkBody.failed, 1);
  assert.deepEqual(bulkBody.results.map((item: { code?: string }) => item.code ?? 'OK'), ['OK', 'OK', 'NOT_FOUND']);
  const stored = await prisma.inventoryFinding.findMany({ where: { id: { in: [a1.id, a2.id, b1.id] } }, orderBy: { dedupKey: 'asc' } });
  assert.deepEqual(stored.map((item) => item.status), ['SNOOZED', 'SNOOZED', 'OPEN']);
  assert.equal(stored[0].snoozedUntil!.toISOString(), bulkBody.snoozedUntil);
  assert.equal(await prisma.auditLog.count({ where: { action: 'INVENTORY_FINDING_SNOOZED', entityId: { in: [a1.id, a2.id] }, metadata: { path: ['reason'], equals: 'Phase C' } } }), 2);

  // Read-only member of room A: a visible item is FORBIDDEN, a sibling-room item is NOT_FOUND. Non-operator roles are rejected outright.
  const forbidden = json(await request('POST', `${url}/bulk`, 'qa-systems-scoped', { action: 'ACKNOWLEDGE', ids: [a1.id, hidden.id] }));
  assert.deepEqual(forbidden.results.map((item: { code: string }) => item.code), ['FORBIDDEN', 'NOT_FOUND']);
  assert.equal((await prisma.inventoryFinding.findUniqueOrThrow({ where: { id: hidden.id } })).status, 'OPEN');
  assert.equal((await request('POST', `${url}/bulk`, 'qa-auditor', { action: 'ACKNOWLEDGE', ids: [a1.id] })).statusCode, 403);
  assert.equal((await request('POST', `${url}/bulk`, 'qa-network-scoped', { action: 'ACKNOWLEDGE', ids: [] })).statusCode, 400);
  assert.equal((await request('POST', `${url}/bulk`, 'qa-network-scoped', { action: 'SNOOZE', ids: [a1.id], durationHours: 0 })).statusCode, 400);
  assert.equal((await request('POST', `${url}/bulk`, 'qa-network-scoped', { action: 'ACKNOWLEDGE', ids: ['not-a-uuid'] })).statusCode, 400);

  // Bulk assign and acknowledge, then the assignee filter and facets.
  const assigned = json(await request('POST', `${url}/bulk`, 'qa-network-scoped', { action: 'ASSIGN', ids: [a1.id, a2.id], userId: ids.scoped }));
  assert.equal(assigned.succeeded, 2);
  const acknowledged = json(await request('POST', `${url}/bulk`, 'qa-admin', { action: 'ACKNOWLEDGE', ids: [a2.id, b1.id] }));
  assert.equal(acknowledged.succeeded, 2);
  const mine = json(await request('GET', `${url}?siteId=${ids.siteA}&assignee=me&search=Phase C`, 'qa-network-scoped'));
  assert.deepEqual(mine.items.map((item: { id: string }) => item.id).sort(), [a1.id, a2.id].sort());
  assert.equal((await request('GET', `${url}?assignee=someone`, 'qa-network-scoped')).statusCode, 400);

  // Facets as the room-A reader: the sibling-room finding is not counted.
  await prisma.inventoryFinding.update({ where: { id: hidden.id }, data: { status: 'SNOOZED' } });
  const facets = json(await request('GET', `/api/v1/inventory-quality/facets?siteId=${ids.siteA}&search=Phase C&status=SNOOZED`, 'qa-systems-scoped'));
  // byStatus ignores the status filter (tab counts); other dimensions apply it.
  assert.deepEqual(facets.byStatus, { OPEN: 0, ACKNOWLEDGED: 1, SNOOZED: 1, RESOLVED: 0 });
  assert.equal(facets.total, 1);
  assert.deepEqual(facets.byRule, [{ rule: 'PHASEC_RULE_ONE', total: 1, byStatus: { SNOOZED: 1 } }]);
  assert.deepEqual(facets.byAssignee.map((item: { userId: string | null; total: number }) => [item.userId, item.total]), [[ids.scoped, 1]]);
  assert.equal(JSON.stringify(facets).includes(hidden.id), false);
  assert.equal((await request('GET', `/api/v1/inventory-quality/facets?siteId=${ids.siteB}`, 'qa-network-scoped')).statusCode, 404);
});

test('Phase C changes: list filters, status summary, calendar overlaps, target search and activity', async () => {
  const day = (offsetHours: number) => new Date(Date.UTC(2031, 0, 10, offsetHours));
  const before = json(await request('GET', `/api/v1/change-plans/summary?siteId=${ids.siteA}`, 'qa-readonly'));
  const approved = await prisma.changePlan.create({ data: { siteId: ids.siteA, title: 'Phase C approved core upgrade', reason: 'Phase C', plannedStartAt: day(8), plannedEndAt: day(12), status: 'APPROVED', createdById: ids.admin, items: { create: [{ entityType: 'DEVICE', entityId: ids.deviceA, operationSummary: 'Upgrade' }, { entityType: 'DEVICE', entityId: ids.deviceSibling, operationSummary: 'Hidden target' }] } } });
  const draft = await prisma.changePlan.create({ data: { siteId: ids.siteA, title: 'Phase C draft access change', reason: 'Phase C', plannedStartAt: day(11), plannedEndAt: day(13), status: 'DRAFT', createdById: ids.admin, items: { create: [{ entityType: 'DEVICE', entityId: ids.deviceA, operationSummary: 'Ports' }, { entityType: 'DEVICE', entityId: ids.deviceSibling, operationSummary: 'Hidden target' }] } } });
  const touching = await prisma.changePlan.create({ data: { siteId: ids.siteA, title: 'Phase C touching change', reason: 'Phase C', plannedStartAt: day(13), plannedEndAt: day(14), status: 'SUBMITTED', createdById: ids.admin, items: { create: [{ entityType: 'DEVICE', entityId: ids.deviceA2, operationSummary: 'Reboot' }] } } });
  const cancelled = await prisma.changePlan.create({ data: { siteId: ids.siteA, title: 'Phase C cancelled', reason: 'Phase C', plannedStartAt: day(9), plannedEndAt: day(10), status: 'CANCELLED', createdById: ids.admin, items: { create: [{ entityType: 'DEVICE', entityId: ids.deviceA, operationSummary: 'Nothing' }] } } });
  const window = await prisma.maintenanceWindow.create({ data: { name: 'Phase C global window', siteId: null, startsAt: day(12), endsAt: day(16) } });

  const summary = json(await request('GET', `/api/v1/change-plans/summary?siteId=${ids.siteA}`, 'qa-readonly'));
  assert.equal(summary.byStatus.APPROVED - before.byStatus.APPROVED, 1);
  assert.equal(summary.byStatus.DRAFT - before.byStatus.DRAFT, 1);
  assert.equal(summary.byStatus.CANCELLED - before.byStatus.CANCELLED, 1);
  assert.equal(summary.total - before.total, 4);
  assert.equal(summary.upcoming - before.upcoming, 2);

  const range = `from=${day(0).toISOString()}&to=${day(24).toISOString()}`;
  const calendarResponse = await request('GET', `/api/v1/change-plans/calendar?siteId=${ids.siteA}&${range}`, 'qa-readonly');
  assert.equal(calendarResponse.statusCode, 200, calendarResponse.body);
  const calendar = json(calendarResponse);
  const plan = (id: string) => calendar.changePlans.find((item: { id: string }) => item.id === id);
  assert.deepEqual(calendar.changePlans.map((item: { id: string }) => item.id), [approved.id, draft.id, touching.id]);
  assert.equal(plan(draft.id).conflict, true);
  assert.equal(plan(approved.id).conflict, false);
  // Shared targets count only what the user can read: the hidden sibling device is shared too but not counted.
  assert.deepEqual(plan(draft.id).overlapsWith.find((item: { id: string }) => item.id === approved.id), { kind: 'CHANGE_PLAN', id: approved.id, overlapStartsAt: day(11).toISOString(), overlapEndsAt: day(12).toISOString(), sharedTargetCount: 1 });
  assert.equal(plan(approved.id).targetCount, 1);
  assert.equal(plan(touching.id).overlapsWith.some((item: { id: string }) => item.id === draft.id), false);
  assert.ok(plan(touching.id).overlapsWith.some((item: { kind: string; id: string }) => item.kind === 'MAINTENANCE_WINDOW' && item.id === window.id));
  assert.equal(calendar.maintenanceWindows[0].global, true);
  assert.equal(calendarResponse.body.includes(ids.deviceSibling), false);
  const withCancelled = json(await request('GET', `/api/v1/change-plans/calendar?siteId=${ids.siteA}&${range}&includeCancelled=true`, 'qa-admin'));
  assert.ok(withCancelled.changePlans.some((item: { id: string }) => item.id === cancelled.id));
  assert.equal((await request('GET', `/api/v1/change-plans/calendar?siteId=${ids.siteA}&from=${day(0).toISOString()}`, 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/change-plans/calendar?siteId=${ids.siteA}&from=${day(0).toISOString()}&to=${new Date(day(0).getTime() + 121 * 86_400_000).toISOString()}`, 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/change-plans/calendar?siteId=${ids.siteB}&${range}`, 'qa-network-legacy')).statusCode, 404);

  const filtered = json(await request('GET', `/api/v1/change-plans?siteId=${ids.siteA}&status=APPROVED,SUBMITTED&${range}`, 'qa-readonly'));
  assert.deepEqual(filtered.map((item: { id: string }) => item.id).sort(), [approved.id, touching.id].sort());
  assert.deepEqual(json(await request('GET', `/api/v1/change-plans?siteId=${ids.siteA}&q=access change`, 'qa-readonly')).map((item: { id: string }) => item.id), [draft.id]);
  assert.equal((await request('GET', `/api/v1/change-plans?siteId=${ids.siteA}&status=DONE`, 'qa-readonly')).statusCode, 400);
  assert.ok(json(await request('GET', `/api/v1/change-plans?siteId=${ids.siteA}`, 'qa-readonly')).length >= 4);

  const search = json(await request('GET', `/api/v1/change-plans/candidates?siteId=${ids.siteA}&q=A2&type=DEVICE`, 'qa-network-scoped'));
  assert.deepEqual(search.groups.flat().map((item: { label: string }) => item.label), ['HTTP Switch A2']);
  const interfaces = json(await request('GET', `/api/v1/change-plans/candidates?siteId=${ids.siteA}&q=switch a2&type=INTERFACE`, 'qa-network-scoped'));
  assert.deepEqual(interfaces.groups.flat().map((item: { label: string }) => item.label), ['HTTP Switch A2 · Gi1/0/1']);
  assert.equal((await request('GET', `/api/v1/change-plans/candidates?siteId=${ids.siteA}&type=ROUTER`, 'qa-network-scoped')).statusCode, 400);

  const created = await request('POST', '/api/v1/change-plans', 'qa-admin', { siteId: ids.siteA, title: 'Phase C activity plan', reason: 'Activity timeline', plannedStartAt: day(30).toISOString(), plannedEndAt: day(31).toISOString(), items: [{ entityType: 'DEVICE', entityId: ids.deviceA, operationSummary: 'Check' }] });
  assert.equal(created.statusCode, 201, created.body);
  const createdId = json(created).id;
  assert.equal((await request('POST', `/api/v1/change-plans/${createdId}/cancel`, 'qa-admin')).statusCode, 201);
  const activity = json(await request('GET', `/api/v1/change-plans/${createdId}/activity`, 'qa-readonly'));
  assert.deepEqual(activity.items.map((item: { action: string }) => item.action), ['CHANGE_PLAN_CREATED', 'CHANGE_PLAN_CANCELLED']);
  assert.equal(activity.items[0].actor.username, 'qa-admin');
  assert.equal(activity.items[0].itemCount, 1);
  assert.equal((await request('GET', `/api/v1/change-plans/${createdId}/activity`, 'qa-network-legacy')).statusCode, 404);
});

test('Phase D alertas: PATCH rule and window, per-rule active counts, scoped maintenance summary', async () => {
  const rule = await prisma.alertRule.create({ data: { name: 'Phase D rule', source: 'PHASE_D', siteId: null, minSeverity: 'HIGH', enabled: true } });
  await prisma.operationalAlert.createMany({ data: [
    { dedupKey: 'phase-d:high', source: 'PHASE_D', severity: 'HIGH', siteId: ids.siteA, title: 'Phase D high', detail: 'shown' },
    { dedupKey: 'phase-d:warning', source: 'PHASE_D', severity: 'WARNING', siteId: ids.siteA, title: 'Phase D warning', detail: 'below threshold' },
  ] });
  const url = '/api/v1/operations/configuration';
  const listed = json(await request('GET', url, 'qa-admin')).rules.find((item: { id: string }) => item.id === rule.id);
  assert.deepEqual(listed.activeAlerts, { matching: 2, governed: 2, shown: 1, belowThreshold: 1, inMaintenance: 0 });

  const patched = await request('PATCH', `${url}/rules/${rule.id}`, 'qa-admin', { minSeverity: 'WARNING' });
  assert.equal(patched.statusCode, 200, patched.body);
  const stored = await prisma.alertRule.findUniqueOrThrow({ where: { id: rule.id } });
  assert.equal(stored.minSeverity, 'WARNING'); assert.equal(stored.name, 'Phase D rule'); assert.equal(stored.enabled, true);
  assert.equal(json(await request('GET', url, 'qa-admin')).rules.find((item: { id: string }) => item.id === rule.id).activeAlerts.shown, 2);
  assert.equal((await request('PATCH', `${url}/rules/${rule.id}`, 'qa-admin', {})).statusCode, 400);
  assert.equal((await request('PATCH', `${url}/rules/${rule.id}`, 'qa-admin', { minSeverity: 'LOUD' })).statusCode, 400);
  assert.equal((await request('PATCH', `${url}/rules/00000000-0000-4000-8000-00000000dead`, 'qa-admin', { enabled: false })).statusCode, 404);
  assert.equal((await request('PATCH', `${url}/rules/${rule.id}`, 'qa-network-scoped', { enabled: false })).statusCode, 403);

  const now = Date.now();
  const activeA = await prisma.maintenanceWindow.create({ data: { name: 'Phase D active A', siteId: ids.siteA, startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 3_600_000) } });
  const upcomingB = await prisma.maintenanceWindow.create({ data: { name: 'Phase D upcoming B', siteId: ids.siteB, startsAt: new Date(now + 86_400_000), endsAt: new Date(now + 90_000_000) } });
  const far = await prisma.maintenanceWindow.create({ data: { name: 'Phase D far global', siteId: null, startsAt: new Date(now + 20 * 86_400_000), endsAt: new Date(now + 21 * 86_400_000) } });
  const windowPatch = await request('PATCH', `${url}/maintenance-windows/${far.id}`, 'qa-admin', { startsAt: new Date(now + 2 * 86_400_000).toISOString(), endsAt: new Date(now + 3 * 86_400_000).toISOString(), reason: 'moved' });
  assert.equal(windowPatch.statusCode, 200, windowPatch.body);
  assert.equal(await prisma.auditLog.count({ where: { action: 'MAINTENANCE_WINDOW_UPDATED', entityId: far.id } }), 1);
  assert.equal((await request('PATCH', `${url}/maintenance-windows/${far.id}`, 'qa-admin', { endsAt: new Date(now).toISOString() })).statusCode, 400);

  const summaryResponse = await request('GET', '/api/v1/operations/maintenance/summary', 'qa-network-scoped');
  assert.equal(summaryResponse.statusCode, 200, summaryResponse.body);
  const summary = json(summaryResponse);
  assert.ok(summary.active.some((item: { id: string }) => item.id === activeA.id));
  assert.ok(summary.upcoming.some((item: { id: string }) => item.id === far.id));
  assert.equal(summaryResponse.body.includes(upcomingB.id), false);
  assert.equal(summary.criticalAlertsUnaffected, true);
  assert.equal(summary.horizonDays, 7);
  assert.ok(json(await request('GET', '/api/v1/operations/maintenance/summary', 'qa-admin')).upcoming.some((item: { id: string }) => item.id === upcomingB.id));
  assert.equal((await request('GET', `/api/v1/operations/maintenance/summary?siteId=${ids.siteB}`, 'qa-network-scoped')).statusCode, 404);
});

test('Phase D drill-through: device status, critical and lifecycle filters keep room isolation', async () => {
  await prisma.device.updateMany({ where: { siteId: ids.siteA }, data: { isCritical: false, status: 'ACTIVE' } });
  await prisma.device.update({ where: { id: ids.deviceA2 }, data: { isCritical: true, status: 'MAINTENANCE' } });
  await prisma.device.update({ where: { id: ids.deviceSibling }, data: { isCritical: true } });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  await prisma.lifecycleDate.createMany({ data: [
    { deviceId: ids.deviceA, kind: 'PHASE_D_SUPPORT', dueDate: new Date(today.getTime() - 86_400_000) },
    { deviceId: ids.deviceA2, kind: 'PHASE_D_SUPPORT', dueDate: new Date(today.getTime() + 10 * 86_400_000) },
  ] });
  const names = async (query: string, persona = 'qa-systems-scoped') => {
    const response = await request('GET', `/api/v1/devices?siteId=${ids.siteA}&${query}`, persona);
    assert.equal(response.statusCode, 200, response.body);
    return json(response).items.map((item: { name: string }) => item.name).sort();
  };
  assert.deepEqual(await names('critical=true'), ['HTTP Switch A2']);
  assert.deepEqual(await names('critical=true', 'qa-admin'), ['HTTP Hidden Switch', 'HTTP Switch A2']);
  assert.deepEqual(await names('status=MAINTENANCE'), ['HTTP Switch A2']);
  assert.deepEqual(await names('lifecycle=overdue&lifecycleKind=PHASE_D_SUPPORT'), ['HTTP Switch A']);
  assert.deepEqual(await names('lifecycle=due:30&lifecycleKind=PHASE_D_SUPPORT'), ['HTTP Switch A2']);
  assert.deepEqual(await names('lifecycle=due:5&lifecycleKind=PHASE_D_SUPPORT'), []);
  for (const bad of ['status=BROKEN', 'critical=maybe', 'lifecycle=soon']) {
    const response = await request('GET', `/api/v1/devices?${bad}`, 'qa-admin');
    assert.equal(response.statusCode, 400, bad);
    assert.match(json(response).code, /^DEVICE_/);
  }
});

test('Phase D IPAM: utilisation on the subnet list, next free IPs and reserve-next with Site isolation', async () => {
  await prisma.ipAddress.createMany({ data: [
    { address: '10.250.1.200', subnetId: ids.subnetA, state: 'OCCUPIED', source: 'MANUAL' },
    { address: '10.250.1.201', subnetId: ids.subnetA, state: 'FREE', source: 'MANUAL' },
  ] });
  const list = await request('GET', '/api/v1/subnets?sort=utilization', 'qa-network-scoped');
  assert.equal(list.statusCode, 200, list.body);
  const listed = json(list);
  assert.equal(list.body.includes(ids.subnetB), false);
  assert.ok(listed.items.every((item: { utilization: { band: string } }) => typeof item.utilization.band === 'string'));
  const percents = listed.items.map((item: { utilization: { utilizationPercent: number | null } }) => item.utilization.utilizationPercent).filter((value: number | null) => value !== null);
  assert.deepEqual(percents, [...percents].sort((a: number, b: number) => b - a));
  const subnetA = listed.items.find((item: { id: string }) => item.id === ids.subnetA);
  assert.equal(subnetA.utilization.usableCapacity, 254);
  assert.equal(subnetA.utilization.band, 'OK');
  assert.ok(subnetA.utilization.allocated >= 3);
  assert.equal(json(await request('GET', '/api/v1/subnets?band=CRITICAL', 'qa-admin')).total, 0);
  assert.equal(json(await request('GET', '/api/v1/subnets', 'qa-admin')).items[0].utilization.band, 'OK');
  assert.equal((await request('GET', '/api/v1/subnets?band=HOT', 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', '/api/v1/subnets?sort=name', 'qa-admin')).statusCode, 400);

  const range = 'from=10.250.1.200&to=10.250.1.205';
  const next = await request('GET', `/api/v1/subnets/${ids.subnetA}/next-free?count=2&${range}`, 'qa-readonly');
  assert.equal(next.statusCode, 200, next.body);
  assert.deepEqual(json(next).items.map((item: { address: string; tracked: boolean }) => [item.address, item.tracked]), [['10.250.1.201', true], ['10.250.1.202', false]]);
  assert.equal(json(next).exhausted, false);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetB}/next-free`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetA}/next-free?count=33`, 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetA}/next-free?from=10.250.2.1`, 'qa-admin')).statusCode, 400);

  assert.equal((await request('POST', `/api/v1/subnets/${ids.subnetA}/reserve-next`, 'qa-readonly', { count: 1, reason: 'denied' })).statusCode, 403);
  assert.equal((await request('POST', `/api/v1/subnets/${ids.subnetB}/reserve-next`, 'qa-network-scoped', { count: 1, reason: 'other site' })).statusCode, 404);
  const reserved = await request('POST', `/api/v1/subnets/${ids.subnetA}/reserve-next`, 'qa-network-scoped', { count: 2, from: '10.250.1.200', to: '10.250.1.205', durationHours: 4, reason: 'Phase D rollout' });
  assert.equal(reserved.statusCode, 201, reserved.body);
  const reservedBody = json(reserved);
  assert.deepEqual(reservedBody.reservations.map((item: { ipAddress: { address: string }; createdIpAddress: boolean }) => [item.ipAddress.address, item.createdIpAddress]), [['10.250.1.201', false], ['10.250.1.202', true]]);
  const rows = await prisma.ipAddress.findMany({ where: { address: { in: ['10.250.1.201', '10.250.1.202'] } }, include: { reservations: true }, orderBy: { address: 'asc' } });
  assert.deepEqual(rows.map((row) => [row.state, row.reservations.length]), [['RESERVED', 1], ['RESERVED', 1]]);
  assert.equal(await prisma.auditLog.count({ where: { action: 'IP_RESERVATION_CREATED', metadata: { path: ['reserveNext'], equals: true } } }), 2);
  const exhausted = await request('POST', `/api/v1/subnets/${ids.subnetA}/reserve-next`, 'qa-network-scoped', { count: 2, from: '10.250.1.200', to: '10.250.1.203', reason: 'too many' });
  assert.equal(exhausted.statusCode, 409, exhausted.body);
  assert.equal(json(exhausted).code, 'IP_RANGE_EXHAUSTED');
  assert.equal(json(exhausted).details.available, 1);
  assert.equal((await request('POST', `/api/v1/subnets/${ids.subnetA}/reserve-next`, 'qa-network-scoped', { count: 1 })).statusCode, 400);
});

test('Phase D discovery: bulk review with per-item results, IPAM state per result and run duration', async () => {
  const startedAt = new Date(Date.now() - 120_000);
  const jobA = await prisma.discoveryJob.create({ data: { name: 'Phase D job A', subnetId: ids.subnetA, methods: ['ICMP'], tcpPorts: [], status: 'COMPLETED', startedAt, completedAt: new Date(startedAt.getTime() + 45_000) } });
  const jobB = await prisma.discoveryJob.create({ data: { name: 'Phase D job B', subnetId: ids.subnetB, methods: ['ICMP'], tcpPorts: [], status: 'COMPLETED' } });
  const known = await prisma.discoveryResult.create({ data: { jobId: jobA.id, address: '10.250.1.10', icmpReachable: true, openPorts: [] } });
  const unknown = await prisma.discoveryResult.create({ data: { jobId: jobA.id, address: '10.250.1.240', icmpReachable: true, openPorts: [] } });
  const otherSite = await prisma.discoveryResult.create({ data: { jobId: jobB.id, address: '10.250.2.240', icmpReachable: true, openPorts: [] } });

  const jobs = json(await request('GET', '/api/v1/discovery/jobs?status=COMPLETED,FAILED', 'qa-network-scoped'));
  const listedJob = jobs.items.find((item: { id: string }) => item.id === jobA.id);
  assert.equal(listedJob.durationMs, 45_000);
  assert.equal(jobs.items.some((item: { id: string }) => item.id === jobB.id), false);

  const results = json(await request('GET', `/api/v1/discovery/jobs/${jobA.id}/results`, 'qa-network-scoped'));
  const byId = new Map(results.map((item: { id: string }) => [item.id, item]));
  assert.equal((byId.get(known.id) as { ipam: { state: string; hostName: string } }).ipam.state, 'OCCUPIED');
  assert.equal((byId.get(known.id) as { ipam: { hostName: string } }).ipam.hostName, 'HTTP Multi Host');
  assert.equal((byId.get(unknown.id) as { ipam: unknown }).ipam, null);

  const missing = '00000000-0000-4000-8000-00000000beef';
  const bulk = await request('POST', '/api/v1/discovery/results/bulk-review', 'qa-network-scoped', { ids: [known.id, unknown.id, otherSite.id, missing], status: 'IGNORED' });
  assert.equal(bulk.statusCode, 201, bulk.body);
  const body = json(bulk);
  assert.equal(body.total, 4); assert.equal(body.succeeded, 2); assert.equal(body.failed, 2);
  assert.deepEqual(body.items.map((item: { ok: boolean; error?: { statusCode: number } }) => item.ok ? 200 : item.error!.statusCode), [200, 200, 404, 404]);
  assert.equal((await prisma.discoveryResult.findUniqueOrThrow({ where: { id: otherSite.id } })).status, 'PENDING');
  assert.equal((await request('POST', '/api/v1/discovery/results/bulk-review', 'qa-auditor', { ids: [known.id], status: 'IGNORED' })).statusCode, 403);
  assert.equal((await request('POST', '/api/v1/discovery/results/bulk-review', 'qa-network-scoped', { ids: [known.id, known.id], status: 'IGNORED' })).statusCode, 400);
  assert.equal((await request('POST', '/api/v1/discovery/results/bulk-review', 'qa-network-scoped', { ids: [known.id], status: 'PENDING' })).statusCode, 400);
});

test('Phase D SNMP: fleet summary, drift list and bulk drift review stay inside the visible Sites', async () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  await prisma.snmpDeviceConfig.upsert({ where: { deviceId: ids.deviceA2 }, create: { deviceId: ids.deviceA2, enabled: true, lastStatus: 'FAILED', lastPollAt: minutesAgo(5), lastErrorCode: 'TIMEOUT' }, update: { enabled: true, lastStatus: 'FAILED', lastPollAt: minutesAgo(5), lastErrorCode: 'TIMEOUT' } });
  await prisma.snmpDeviceConfig.upsert({ where: { deviceId: ids.deviceB }, create: { deviceId: ids.deviceB, enabled: true, lastStatus: 'FAILED', lastPollAt: minutesAgo(5) }, update: { enabled: true, lastStatus: 'FAILED', lastPollAt: minutesAgo(5) } });
  const snapshot = async (deviceId: string) => {
    const job = await prisma.snmpJob.create({ data: { deviceId, type: 'POLL', status: 'COMPLETED' } });
    return prisma.snmpSnapshot.create({ data: { deviceId, jobId: job.id } });
  };
  const snapA2 = await snapshot(ids.deviceA2);
  const snapB = await snapshot(ids.deviceB);
  const driftA2 = await prisma.snmpDrift.create({ data: { deviceId: ids.deviceA2, interfaceId: ids.interfaceA2, snapshotId: snapA2.id, field: 'description', documentedValue: 'old', observedValue: 'new' } });
  const driftB = await prisma.snmpDrift.create({ data: { deviceId: ids.deviceB, snapshotId: snapB.id, field: 'sysName', documentedValue: 'b', observedValue: 'b2' } });

  const summaryResponse = await request('GET', '/api/v1/snmp/fleet/summary', 'qa-network-scoped');
  assert.equal(summaryResponse.statusCode, 200, summaryResponse.body);
  const summary = json(summaryResponse);
  assert.ok(summary.attention.some((item: { deviceId: string; reason: string }) => item.deviceId === ids.deviceA2 && item.reason === 'FAILED'));
  assert.equal(summaryResponse.body.includes(ids.deviceB), false);
  assert.ok(summary.drift.pending >= 1);
  assert.ok(summary.devices.total >= summary.devices.configured);
  assert.ok(json(await request('GET', '/api/v1/snmp/fleet/summary', 'qa-admin')).attention.some((item: { deviceId: string }) => item.deviceId === ids.deviceB));
  assert.equal((await request('GET', `/api/v1/snmp/fleet/summary?siteId=${ids.siteB}`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('GET', '/api/v1/snmp/fleet/summary', 'qa-systems-scoped')).statusCode, 403);

  const drifts = await request('GET', '/api/v1/snmp/drifts', 'qa-network-scoped');
  assert.equal(drifts.statusCode, 200, drifts.body);
  assert.ok(json(drifts).items.some((item: { id: string; device: { name: string } }) => item.id === driftA2.id && item.device.name === 'HTTP Switch A2'));
  assert.equal(drifts.body.includes(driftB.id), false);
  assert.equal((await request('GET', '/api/v1/snmp/drifts?status=MAYBE', 'qa-network-scoped')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/snmp/drifts?siteId=${ids.siteB}`, 'qa-network-scoped')).statusCode, 404);

  const bulk = json(await request('POST', '/api/v1/snmp/drifts/bulk-review', 'qa-network-scoped', { ids: [driftA2.id, driftB.id], status: 'ACCEPTED' }));
  assert.equal(bulk.succeeded, 1); assert.equal(bulk.failed, 1);
  assert.equal((await prisma.snmpDrift.findUniqueOrThrow({ where: { id: driftB.id } })).status, 'PENDING');
  assert.equal((await prisma.snmpDrift.findUniqueOrThrow({ where: { id: driftA2.id } })).status, 'ACCEPTED');
  assert.equal((await request('POST', '/api/v1/snmp/drifts/bulk-review', 'qa-readonly', { ids: [driftB.id], status: 'ACCEPTED' })).statusCode, 403);
});

test('Phase D search: opt-in types, audit only for ADMIN and AUDITOR, change plans per Site, legacy response unchanged', async () => {
  const planA = await prisma.changePlan.create({ data: { siteId: ids.siteA, title: 'Zebrafish core migration', reason: 'Phase D search', plannedStartAt: new Date(Date.UTC(2032, 0, 1)), plannedEndAt: new Date(Date.UTC(2032, 0, 2)), createdById: ids.admin } });
  const planB = await prisma.changePlan.create({ data: { siteId: ids.siteB, title: 'Zebrafish edge migration', reason: 'Phase D search', plannedStartAt: new Date(Date.UTC(2032, 0, 1)), plannedEndAt: new Date(Date.UTC(2032, 0, 2)), createdById: ids.admin } });
  await prisma.auditLog.create({ data: { userId: ids.admin, action: 'ZEBRAFISH_TEST_EVENT', entityType: 'Device', entityId: ids.deviceA } });

  const legacy = await request('GET', '/api/v1/dashboard/search?q=Zebrafish', 'qa-admin');
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(json(legacy).items.some((item: { type: string }) => ['CHANGE_PLAN', 'AUDIT_EVENT', 'QUALITY_FINDING'].includes(item.type)), false);

  const scoped = json(await request('GET', '/api/v1/dashboard/search?q=Zebrafish&types=CHANGE_PLAN', 'qa-network-scoped'));
  assert.deepEqual(scoped.items.map((item: { id: string }) => item.id), [planA.id]);
  assert.match(scoped.items[0].href, /^\/alteracoes\?/);
  assert.deepEqual(json(await request('GET', '/api/v1/dashboard/search?q=Zebrafish&types=CHANGE_PLAN', 'qa-admin')).items.map((item: { id: string }) => item.id).sort(), [planA.id, planB.id].sort());

  const auditor = json(await request('GET', '/api/v1/dashboard/search?q=zebrafish_test&types=AUDIT_EVENT', 'qa-auditor'));
  assert.equal(auditor.items.length, 1);
  assert.equal(auditor.items[0].type, 'AUDIT_EVENT');
  assert.deepEqual(json(await request('GET', '/api/v1/dashboard/search?q=zebrafish_test&types=AUDIT_EVENT', 'qa-readonly')).items, []);
  assert.deepEqual(json(await request('GET', '/api/v1/dashboard/search?q=zebrafish_test&types=AUDIT_EVENT', 'qa-network-scoped')).items, []);
  assert.ok(json(await request('GET', '/api/v1/dashboard/search?q=Zebrafish&types=all&limit=20', 'qa-admin')).items.length <= 20);
  assert.equal((await request('GET', '/api/v1/dashboard/search?q=Zebrafish&types=PEOPLE', 'qa-admin')).statusCode, 400);
});

test('Phase E portal: favourites, check-all link health and the pending role-request queue', async () => {
  const server = createServer((req, res) => { res.statusCode = req.url === '/down' ? 503 : 200; res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const up = await prisma.applicationLink.create({ data: { name: 'Phase E up', url: `${base}/up`, checkAvailability: true } });
    const down = await prisma.applicationLink.create({ data: { name: 'Phase E down', url: `${base}/down`, checkAvailability: true } });
    const adminOnly = await prisma.applicationLink.create({ data: { name: 'Phase E admin only', url: `${base}/admin`, roles: { create: { role: 'ADMIN' } } } });

    assert.equal((await request('PUT', `/api/v1/application-links/${down.id}/favorite`, 'qa-readonly', {})).statusCode, 200);
    const second = await request('PUT', `/api/v1/application-links/${up.id}/favorite`, 'qa-readonly', { sortOrder: 0 });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(json(await request('PUT', `/api/v1/application-links/${down.id}/favorite`, 'qa-readonly', { sortOrder: 5 })).sortOrder, 5);
    assert.equal(json(await request('PUT', `/api/v1/application-links/${down.id}/favorite`, 'qa-readonly', {})).sortOrder, 5);
    assert.equal((await request('PUT', `/api/v1/application-links/${up.id}/favorite`, 'qa-readonly', { sortOrder: 20_000 })).statusCode, 400);
    assert.equal((await request('PUT', `/api/v1/application-links/${adminOnly.id}/favorite`, 'qa-readonly', {})).statusCode, 404);
    const favorites = json(await request('GET', '/api/v1/application-links/favorites', 'qa-readonly'));
    assert.deepEqual(favorites.items.map((item: { id: string }) => item.id), [up.id, down.id]);
    assert.deepEqual(json(await request('GET', '/api/v1/application-links/favorites', 'qa-auditor')).items, []);
    const listed = json(await request('GET', '/api/v1/application-links', 'qa-readonly'));
    const flags = (Array.isArray(listed) ? listed : listed.items).filter((item: { name: string }) => item.name.startsWith('Phase E')).map((item: { name: string; isFavorite: boolean }) => [item.name, item.isFavorite]).sort();
    assert.deepEqual(flags, [['Phase E down', true], ['Phase E up', true]]);
    assert.deepEqual(json(await request('DELETE', `/api/v1/application-links/${down.id}/favorite`, 'qa-readonly')), { linkId: down.id, isFavorite: false });
    assert.equal((await request('DELETE', `/api/v1/application-links/${down.id}/favorite`, 'qa-readonly')).statusCode, 200);

    assert.equal((await request('POST', '/api/v1/application-links/check-all', 'qa-readonly')).statusCode, 403);
    const checked = await request('POST', '/api/v1/application-links/check-all', 'qa-admin');
    assert.equal(checked.statusCode, 201, checked.body);
    const checkedBody = json(checked);
    assert.equal(checkedBody.scope, 'CHECK_AVAILABILITY');
    assert.equal(checkedBody.checked, 2); assert.equal(checkedBody.available, 1); assert.equal(checkedBody.unavailable, 1);
    assert.equal((await prisma.applicationLink.findUniqueOrThrow({ where: { id: down.id } })).isAvailable, false);
    assert.equal((await prisma.applicationLink.findUniqueOrThrow({ where: { id: up.id } })).isAvailable, true);
    assert.equal(json(await request('POST', '/api/v1/application-links/check-all?all=true', 'qa-admin')).checked, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  await prisma.roleRequest.deleteMany({});
  const old = await prisma.roleRequest.create({ data: { userId: ids.readonly, roles: ['NETWORK_OPERATOR'], createdAt: new Date(Date.now() - 86_400_000) } });
  const fresh = await prisma.roleRequest.create({ data: { userId: ids.auditor, roles: ['NETWORK_OPERATOR'], status: 'PROCESSING' } });
  const decided = await prisma.roleRequest.create({ data: { userId: ids.systems, roles: ['ADMIN'], status: 'REJECTED', decidedAt: new Date() } });
  const queue = await request('GET', '/api/v1/settings/role-requests', 'qa-admin');
  assert.equal(queue.statusCode, 200, queue.body);
  assert.deepEqual(json(queue).items.map((item: { id: string }) => item.id), [old.id, fresh.id]);
  assert.equal(json(queue).items[0].user.username, 'qa-readonly');
  assert.equal(json(queue).pendingTotal, 2);
  assert.deepEqual(json(await request('GET', '/api/v1/settings/role-requests?status=REJECTED', 'qa-admin')).items.map((item: { id: string }) => item.id), [decided.id]);
  assert.equal((await request('GET', '/api/v1/settings/role-requests?status=LOST', 'qa-admin')).statusCode, 400);
  assert.equal((await request('GET', '/api/v1/settings/role-requests', 'qa-network-scoped')).statusCode, 403);
});

test('Phase C review fixes: activity hides plan-wide counts from scoped users, list/get batch visibility, facet bounds, CORS export headers', async () => {
  const day = (offset: number) => new Date(Date.UTC(2031, 1, 1 + offset, 8));
  const created = await request('POST', '/api/v1/change-plans', 'qa-admin', { siteId: ids.siteA, title: 'Phase C hidden-target activity', reason: 'Review fix', plannedStartAt: day(1).toISOString(), plannedEndAt: day(2).toISOString(), items: [{ entityType: 'DEVICE', entityId: ids.deviceA, operationSummary: 'Visible' }, { entityType: 'DEVICE', entityId: ids.deviceSibling, operationSummary: 'Hidden' }] });
  assert.equal(created.statusCode, 201, created.body);
  const id = json(created).id;

  // A scoped user who cannot see the sibling-room device gets no plan-wide counts (they would reveal the hidden target).
  const scoped = await request('GET', `/api/v1/change-plans/${id}/activity`, 'qa-readonly');
  assert.equal(scoped.statusCode, 200, scoped.body);
  const scopedBody = json(scoped);
  assert.equal(scopedBody.countsHidden, true);
  assert.equal(scopedBody.items[0].action, 'CHANGE_PLAN_CREATED');
  assert.equal(scopedBody.items[0].itemCount, null);
  assert.equal(scopedBody.items[0].knownImpactCount, null);
  assert.equal(scopedBody.items[0].coverage, null);
  // Someone who sees every target still gets them.
  const full = json(await request('GET', `/api/v1/change-plans/${id}/activity`, 'qa-admin'));
  assert.equal(full.countsHidden, false);
  assert.equal(full.items[0].itemCount, 2);

  // get and list use the batched visibility check: the hidden target is dropped, the visible one kept.
  const got = json(await request('GET', `/api/v1/change-plans/${id}`, 'qa-readonly'));
  assert.deepEqual(got.items.map((item: { entityId: string }) => item.entityId), [ids.deviceA]);
  const listed = json(await request('GET', `/api/v1/change-plans?siteId=${ids.siteA}&q=hidden-target activity`, 'qa-readonly'));
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].items.map((item: { entityId: string }) => item.entityId), [ids.deviceA]);
  assert.equal(JSON.stringify(listed).includes(ids.deviceSibling), false);
  const adminList = json(await request('GET', `/api/v1/change-plans?siteId=${ids.siteA}&q=hidden-target activity`, 'qa-admin'));
  assert.equal(adminList[0].items.length, 2);

  // Audit facets without from/to are bounded to the default window and say so.
  const old = await prisma.auditLog.create({ data: { action: 'PHASE_C_OLD_FACET_ONLY', createdAt: new Date(Date.now() - 200 * 86_400_000) } });
  const facets = json(await request('GET', '/api/v1/audit/facets', 'qa-admin'));
  assert.ok(facets.from);
  assert.equal(facets.actions.some((item: { value: string }) => item.value === 'PHASE_C_OLD_FACET_ONLY'), false);
  const wide = json(await request('GET', `/api/v1/audit/facets?from=${new Date(Date.now() - 365 * 86_400_000).toISOString()}`, 'qa-admin'));
  assert.equal(wide.actions.some((item: { value: string }) => item.value === 'PHASE_C_OLD_FACET_ONLY'), true);
  await prisma.auditLog.delete({ where: { id: old.id } });

  // Quality facets report whether the scan was capped.
  assert.equal(json(await request('GET', `/api/v1/inventory-quality/facets?siteId=${ids.siteA}`, 'qa-admin')).truncated, false);

  // The browser may read the export headers cross-origin.
  const cors = await app.inject({ method: 'GET', url: '/api/v1/audit/events/export?limit=1', headers: { 'x-test-user': 'qa-admin', origin: 'http://localhost:3000' } });
  assert.equal(cors.statusCode, 200, cors.body);
  assert.match(String(cors.headers['access-control-expose-headers']), /X-Export-Row-Count/);
  assert.match(String(cors.headers['access-control-expose-headers']), /X-Export-Truncated/);
});
