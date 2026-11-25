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
import { CanActivate, ConflictException, ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
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
import { deliverLifecycleReminders } from '../src/infrastructure/lifecycle-reminders';
import { CriticalAssetsService } from '../src/critical-assets/critical-assets.service';
import { EmailSender } from '../src/notifications/delivery/email-sender';
import { NotificationDeliveryService } from '../src/notifications/delivery/notification-delivery.service';
import { OperationsService } from '../src/operations/operations.service';
import { ScheduledReportsService } from '../src/reports/scheduled-reports.service';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('HTTP integration tests require an isolated DATABASE_URL whose database name ends in _test.');

// Step 31: the background poll is off so these tests drive delivery explicitly; the immediate kick still runs.
process.env.NOTIFICATION_DELIVERY_DISABLED = 'true';
// Step 32: the minute scheduler is off; the tests call tick() and run() themselves.
process.env.SCHEDULED_REPORTS_DISABLED = 'true';

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

test('site capacity outlook respects source access and reads saved daily NetApp and rack samples', async () => {
  const observedAt = new Date();
  const past = (days: number) => new Date(observedAt.getTime() - days * 86_400_000);
  const bytes = Buffer.from([0]);
  const integration = await prisma.netAppIntegration.create({ data: {
    siteId: ids.siteA, endpointUrl: 'https://ontap.example.test', username: 'capacity-fixture',
    ciphertext: bytes, iv: bytes, authTag: bytes, wrappedDek: bytes, wrapIv: bytes, wrapAuthTag: bytes, keyId: 'fixture',
    snapshot: { observedAt: observedAt.toISOString(), aggregates: [], volumes: [{ uuid: 'fixture-volume', name: 'Fixture volume', sizeBytes: 100, usedBytes: 70 }] },
  } });
  try {
    await prisma.netAppCapacitySample.createMany({ data: [
      { integrationId: integration.id, kind: 'VOLUME', objectKey: 'fixture-volume', name: 'Fixture volume', sizeBytes: 100n, usedBytes: 50n, observedAt: past(14) },
      { integrationId: integration.id, kind: 'VOLUME', objectKey: 'fixture-volume', name: 'Fixture volume', sizeBytes: 100n, usedBytes: 60n, observedAt: past(7) },
    ] });
    await prisma.rackCapacitySample.create({ data: { rackId: ids.rackA, resourceKey: 'space', sampledAt: past(1), used: 1, total: 42 } });

    const url = `/api/v1/sites/${ids.siteA}/capacity-outlook`;
    assert.equal((await request('GET', url)).statusCode, 401);
    assert.equal((await request('GET', url, 'qa-network-legacy')).statusCode, 404);
    assert.equal((await request('GET', `${url}?warningPercent=90&criticalPercent=85`, 'qa-readonly')).statusCode, 400);
    const response = await request('GET', `${url}?warningPercent=75&criticalPercent=85`, 'qa-readonly');
    assert.equal(response.statusCode, 200, response.body);
    const outlook = json(response);
    assert.deepEqual(outlook.thresholds, { warningPercent: 75, criticalPercent: 85 });
    assert.ok(outlook.items.some((item: { id: string }) => item.id === ids.subnetA));
    assert.ok(!outlook.items.some((item: { id: string }) => item.id === ids.rackSibling));
    const space = outlook.items.find((item: { kind: string }) => item.kind === 'RACK_SPACE');
    assert.equal(space.sampleCount, 2);
    assert.equal(space.estimatedAt, null);
    const volume = outlook.items.find((item: { kind: string }) => item.kind === 'NETAPP_VOLUME');
    assert.equal(volume.currentPercent, 70);
    assert.equal(volume.sampleCount, 3);
    assert.equal(Date.parse(volume.estimatedAt) - observedAt.getTime(), 10.5 * 86_400_000);
  } finally {
    await prisma.netAppIntegration.delete({ where: { id: integration.id } });
    await prisma.rackCapacitySample.deleteMany({ where: { rackId: ids.rackA, sampledAt: past(1) } });
  }
});

test('enforces authentication and persona-level RBAC over HTTP', async () => {
  assert.equal((await request('GET', '/api/v1/sites')).statusCode, 401);
  assert.equal((await request('GET', '/api/v1/sites', 'qa-readonly')).statusCode, 200);
  assert.equal((await request('POST', '/api/v1/ip-addresses', 'qa-readonly', { address: '10.250.1.20', subnetId: ids.subnetA })).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/audit/events', 'qa-auditor')).statusCode, 200);
  assert.equal((await request('POST', '/api/v1/ip-addresses', 'qa-auditor', { address: '10.250.1.21', subnetId: ids.subnetA })).statusCode, 403);
});

test('lists scoped Linux hosts and issues each agent credential once until revocation', async (context) => {
  const host = await prisma.host.create({ data: { name: 'Step 26 host', deviceId: ids.deviceA } });
  const hidden = await prisma.host.create({ data: { name: 'Step 26 other site', deviceId: ids.deviceB } });
  context.after(async () => { await prisma.host.deleteMany({ where: { id: { in: [host.id, hidden.id] } } }); });
  const inventory = '/api/v1/linux-agents/hosts';
  const enrollments = '/api/v1/linux-agents/enrollments';
  const all = json(await request('GET', inventory, 'qa-admin'));
  assert.equal(all.items.some((item: { id: string }) => item.id === hidden.id), true);
  const scoped = await request('GET', `${inventory}?siteId=${ids.siteA}`, 'qa-readonly');
  assert.equal(scoped.statusCode, 200);
  const items = json(scoped).items;
  assert.equal(items.some((item: { id: string }) => item.id === hidden.id), false);
  assert.equal(items.find((item: { id: string }) => item.id === host.id).agent, null);
  assert.deepEqual(items.find((item: { id: string }) => item.id === ids.hostMulti).ipAddresses.map((ip: { address: string }) => ip.address), ['10.250.1.10']);
  assert.equal((await request('GET', `${inventory}/${hidden.id}/services`, 'qa-readonly')).statusCode, 404);
  const services = await request('GET', `${inventory}/${ids.hostManual}/services`, 'qa-readonly');
  assert.equal(services.statusCode, 200);
  assert.equal(json(services)[0].name, 'Manual HTTP');

  assert.equal((await request('POST', enrollments, 'qa-readonly', { hostId: host.id })).statusCode, 403);
  const responses = await Promise.all([
    request('POST', enrollments, 'qa-admin', { hostId: host.id }),
    request('POST', enrollments, 'qa-admin', { hostId: host.id }),
  ]);
  assert.deepEqual(responses.map((result) => result.statusCode), [201, 201]);
  assert.equal(responses.every((result) => result.headers['cache-control'] === 'no-store'), true);
  const bodies = responses.map(json);
  assert.equal(bodies.filter((body) => typeof body.token === 'string').length, 1);
  assert.equal(bodies.filter((body) => body.tokenAlreadyIssued === true).length, 1);
  const { id: agentId, token } = bodies.find((body) => body.token);
  const revoke = `/api/v1/linux-agents/${agentId}`;
  assert.equal((await request('DELETE', revoke, 'qa-readonly')).statusCode, 403);

  const heartbeat = (hostname: string) => app.inject({
    method: 'POST',
    url: '/api/v1/linux-agents/heartbeat',
    headers: { authorization: `Bearer ${token}` },
    payload: { hostname, os: 'Linux', osVersion: '6', agentVersion: '1.0.0' },
  });
  assert.equal((await heartbeat('step26-host')).statusCode, 200);
  const current = () => request('GET', inventory, 'qa-admin').then(json).then((data) => data.items.find((item: { id: string }) => item.id === host.id));
  const online = await current();
  assert.equal(online.agent.state, 'ONLINE');
  assert.equal('token' in online.agent || 'tokenHash' in online.agent, false);
  assert.equal(typeof all.staleMinutes, 'number');
  await prisma.linuxAgent.update({ where: { id: agentId }, data: { lastHeartbeatAt: new Date(Date.now() - (all.staleMinutes + 1) * 60_000) } });
  assert.equal((await current()).agent.state, 'STALE');
  assert.equal((await request('DELETE', revoke, 'qa-admin')).statusCode, 200);
  assert.equal((await heartbeat('must-not-be-written')).statusCode, 401);
  const revoked = await current();
  assert.equal(revoked.agent.state, 'REVOKED');
  assert.equal(revoked.hostname, 'step26-host');

  const audit = await request('GET', `/api/v1/audit/events/page?entityId=${agentId}`, 'qa-auditor');
  assert.equal(audit.statusCode, 200);
  assert.deepEqual(json(audit).items.map((event: { action: string }) => event.action).sort(), ['LINUX_AGENT_ENROLLED', 'LINUX_AGENT_REVOKED']);
  assert.equal(audit.body.includes(token), false);
  const replacement = json(await request('POST', enrollments, 'qa-admin', { hostId: host.id }));
  assert.equal(typeof replacement.token === 'string' && replacement.token !== token, true);
  assert.equal((await heartbeat('old-token')).statusCode, 401);
  await prisma.host.update({ where: { id: host.id }, data: { deviceId: null } });
  assert.equal((await request('DELETE', revoke, 'qa-admin')).statusCode, 200);
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
  await prisma.snmpListenerConfig.upsert({ where: { id: 'default' }, create: { id: 'default', engineId: '8000b98305aabbccddeeff001122', activeEngineId: '8000b98305aabbccddeeff001122', activeEngineIdSource: 'STORED' }, update: { engineId: '8000b98305aabbccddeeff001122', activeEngineId: '8000b98305aabbccddeeff001122', activeEngineIdSource: 'STORED' } });
  const listenerView = (await request('GET', '/api/v1/settings/snmp-listeners', 'qa-admin')).json();
  assert.equal(listenerView.engineId, '8000b98305aabbccddeeff001122');
  assert.equal(listenerView.engineIdSource, 'STORED');
  assert.equal((await request('PATCH', '/api/v1/settings/snmp-listeners', 'qa-network-scoped', { listenAll: true, interfaceIds: [] })).statusCode, 403);
  assert.equal((await request('PATCH', '/api/v1/settings/snmp-listeners', 'qa-admin', { listenAll: false, interfaceIds: [] })).statusCode, 400);
  assert.equal((await request('PATCH', '/api/v1/settings/snmp-listeners', 'qa-admin', { listenAll: true, interfaceIds: [] })).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-network-scoped')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceB}`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-auditor')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-readonly')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}`, 'qa-systems-scoped')).statusCode, 403);
  // SNMP Phase 2 step 8: read-only device health, same access rules as the SNMP overview.
  const noHealth = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health`, 'qa-readonly');
  assert.equal(noHealth.statusCode, 200);
  assert.deepEqual(noHealth.json(), { deviceId: ids.deviceA, health: null });
  await prisma.snmpDeviceHealth.create({ data: { deviceId: ids.deviceA, vendor: 'cisco', status: 'DEGRADED', observedAt: new Date(), uptimeTicks: 24000n, rebootCount: 1, cpu5sPercent: 97, memoryUsedBytes: 1513000000n, memoryTotalBytes: 1609000000n, issueCount: 1, data: { issues: [{ code: 'FAN_FAULT', component: 'Switch 1 - Fan 2', state: 'critical' }] } } });
  const withHealth = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health`, 'qa-network-scoped');
  assert.equal(withHealth.statusCode, 200);
  assert.equal(withHealth.json().health.status, 'DEGRADED');
  assert.equal(withHealth.json().health.uptimeTicks, '24000');
  assert.equal(withHealth.json().health.memory.totalBytes, '1609000000');
  assert.equal(withHealth.json().health.details.issues[0].code, 'FAN_FAULT');
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health`, 'qa-auditor')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceB}/health`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health`, 'qa-systems-scoped')).statusCode, 403);
  // SNMP Phase 2 step 9: health alert limits per site and device, and the 30-day health history.
  const healthDefaults = await request('GET', '/api/v1/snmp/health-thresholds/defaults', 'qa-readonly');
  assert.equal(healthDefaults.statusCode, 200, healthDefaults.body);
  assert.deepEqual(healthDefaults.json().defaults, { cpuPercent: 90, cpuSustainMinutes: 5, memoryPercent: 90, temperatureHighCelsius: null, temperatureCriticalCelsius: null, interfaceErrorsPerMinute: 10 });
  assert.equal(healthDefaults.json().historyRetentionDays, 30);
  const siteLimits = await request('GET', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-auditor');
  assert.equal(siteLimits.statusCode, 200, siteLimits.body);
  assert.equal(siteLimits.json().site, null);
  assert.equal(siteLimits.json().effective.cpuPercent, 90);
  assert.equal((await request('PUT', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-readonly', { cpuPercent: 80 })).statusCode, 403);
  assert.equal((await request('PUT', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-auditor', { cpuPercent: 80 })).statusCode, 403);
  assert.equal((await request('PUT', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-admin', { cpuPercent: 101 })).statusCode, 400);
  assert.equal((await request('PUT', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-admin', { bogus: 1 })).statusCode, 400);
  const badTemps = await request('PUT', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-admin', { temperatureHighCelsius: 60, temperatureCriticalCelsius: 50 });
  assert.equal(badTemps.statusCode, 400);
  assert.equal(badTemps.json().code, 'SNMP_HEALTH_THRESHOLD_INVALID');
  const siteSaved = await request('PUT', `/api/v1/snmp/sites/${ids.siteA}/health-thresholds`, 'qa-admin', { cpuPercent: 80, memoryPercent: 85 });
  assert.equal(siteSaved.statusCode, 200, siteSaved.body);
  assert.equal(siteSaved.json().site.cpuPercent, 80);
  assert.equal(siteSaved.json().sources.cpuPercent, 'SITE');
  assert.equal(siteSaved.json().sources.cpuSustainMinutes, 'DEFAULT');
  const networkWrite = await request('PUT', `/api/v1/snmp/devices/${ids.deviceA}/health-thresholds`, 'qa-network-scoped', { cpuPercent: 95, temperatureHighCelsius: 55 });
  assert.equal(networkWrite.statusCode, 200, networkWrite.body);
  const deviceLimits = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health-thresholds`, 'qa-readonly');
  assert.equal(deviceLimits.statusCode, 200);
  assert.deepEqual(deviceLimits.json().effective, { cpuPercent: 95, cpuSustainMinutes: 5, memoryPercent: 85, temperatureHighCelsius: 55, temperatureCriticalCelsius: null, interfaceErrorsPerMinute: 10 });
  assert.deepEqual(deviceLimits.json().sources, { cpuPercent: 'DEVICE', cpuSustainMinutes: 'DEFAULT', memoryPercent: 'SITE', temperatureHighCelsius: 'DEVICE', temperatureCriticalCelsius: 'DEFAULT', interfaceErrorsPerMinute: 'DEFAULT' });
  assert.equal(deviceLimits.json().device.updatedById, ids.scoped);
  // PUT replaces: omitted fields go back to inheriting.
  const reset = await request('PUT', `/api/v1/snmp/devices/${ids.deviceA}/health-thresholds`, 'qa-network-scoped', { cpuPercent: 95 });
  assert.equal(reset.json().sources.temperatureHighCelsius, 'DEFAULT');
  assert.equal((await prisma.auditLog.count({ where: { action: 'SNMP_HEALTH_THRESHOLDS_UPDATED', entityId: { in: [ids.siteA, ids.deviceA] } } })), 3);
  assert.equal((await request('PUT', `/api/v1/snmp/devices/${ids.deviceA}/health-thresholds`, 'qa-readonly', { cpuPercent: 95 })).statusCode, 403);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceB}/health-thresholds`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('PUT', `/api/v1/snmp/devices/${ids.deviceB}/health-thresholds`, 'qa-network-scoped', { cpuPercent: 95 })).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health-thresholds`, 'qa-systems-scoped')).statusCode, 403);
  assert.equal((await request('GET', `/api/v1/snmp/devices/not-a-uuid/health-thresholds`, 'qa-admin')).statusCode, 400);
  await prisma.snmpDeviceHealthSample.createMany({ data: [
    { deviceId: ids.deviceA, observedAt: new Date(Date.now() - 2 * 3_600_000), status: 'OK', cpu5sPercent: 20, memoryUsedPercent: 50, issueCount: 0, rebooted: false },
    { deviceId: ids.deviceA, observedAt: new Date(Date.now() - 60_000), status: 'DEGRADED', cpu5sPercent: 97, memoryUsedPercent: 94, issueCount: 1, rebooted: true },
  ] });
  const lastHour = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health/history?hours=1`, 'qa-readonly');
  assert.equal(lastHour.statusCode, 200, lastHour.body);
  assert.equal(lastHour.json().retentionDays, 30);
  assert.deepEqual(lastHour.json().items.map((item: { cpu5sPercent: number; rebooted: boolean }) => [item.cpu5sPercent, item.rebooted]), [[97, true]]);
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health/history`, 'qa-auditor')).json().items.length, 2);
  const badRange = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/health/history?hours=721`, 'qa-readonly');
  assert.equal(badRange.statusCode, 400);
  assert.equal(badRange.json().code, 'SNMP_HEALTH_HISTORY_RANGE_INVALID');
  assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceB}/health/history`, 'qa-network-scoped')).statusCode, 404);
  // SNMP Phase 2 step 10: batch health for the badges, same roles and Site scoping as the per-device read.
  const healthSummary = await request('GET', `/api/v1/snmp/health?deviceIds=${ids.deviceA},${ids.deviceB}`, 'qa-network-scoped');
  assert.equal(healthSummary.statusCode, 200);
  assert.deepEqual(healthSummary.json().items.map((item: { deviceId: string; status: string; issueCount: number }) => [item.deviceId, item.status, item.issueCount]), [[ids.deviceA, 'DEGRADED', 1]]);
  const adminSummary = (await request('GET', `/api/v1/snmp/health?deviceIds=${ids.deviceA},${ids.deviceB}`, 'qa-admin')).json();
  assert.deepEqual(adminSummary.items.map((item: { deviceId: string }) => item.deviceId).sort(), [ids.deviceA, ids.deviceB].sort());
  assert.equal(adminSummary.items.find((item: { deviceId: string }) => item.deviceId === ids.deviceB).status, null);
  assert.equal((await request('GET', `/api/v1/snmp/health?siteId=${ids.siteA}`, 'qa-readonly')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/snmp/health?siteId=${ids.siteA}`, 'qa-auditor')).statusCode, 200);
  assert.equal((await request('GET', '/api/v1/snmp/health', 'qa-systems-scoped')).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/snmp/health?deviceIds=not-a-uuid', 'qa-admin')).statusCode, 400);

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

test('fix F2: SNMP credential delete is refused while in use unless forced, and while a job is running', async (context) => {
  const deviceId = ids.deviceA2;
  const credentialUrl = (purpose: string, query = '') => `/api/v1/snmp/devices/${deviceId}/credentials/${purpose}${query}`;
  const createCredential = (purpose: 'READ' | 'WRITE' | 'TRAP') => prisma.snmpCredential.create({ data: { deviceId, purpose, version: 'V2C', ...encryptCredential({ community: `http-f2-${purpose.toLowerCase()}` }, testKeyring) } });
  const originalSetEnabled = process.env.SNMP_SET_ENABLED;
  context.after(async () => {
    if (originalSetEnabled === undefined) delete process.env.SNMP_SET_ENABLED; else process.env.SNMP_SET_ENABLED = originalSetEnabled;
    await prisma.snmpTrapEvent.deleteMany({ where: { deviceId } });
    await prisma.snmpJob.deleteMany({ where: { deviceId } });
    await prisma.snmpCredential.deleteMany({ where: { deviceId } });
    await prisma.snmpDeviceConfig.deleteMany({ where: { deviceId } });
  });

  // Not in use: deleted at once, plain audit entry.
  const idle = await createCredential('READ');
  assert.equal((await request('DELETE', credentialUrl('READ'), 'qa-network-scoped')).statusCode, 403);
  const plain = await request('DELETE', credentialUrl('READ'), 'qa-admin');
  assert.equal(plain.statusCode, 200, plain.body);
  assert.deepEqual(json(plain), { success: true, forced: false, usages: [] });
  assert.equal(await prisma.auditLog.count({ where: { action: 'SNMP_CREDENTIAL_DELETED', entityId: idle.id } }), 1);
  assert.equal((await request('DELETE', credentialUrl('READ'), 'qa-admin')).statusCode, 404);

  // READ in use by the polling schedule: 409 with the usage list; the credential stays.
  const read = await createCredential('READ');
  await prisma.snmpDeviceConfig.create({ data: { deviceId, enabled: true, intervalMinutes: 15 } });
  const inUse = await request('DELETE', credentialUrl('READ'), 'qa-admin');
  assert.equal(inUse.statusCode, 409, inUse.body);
  assert.equal(json(inUse).code, 'SNMP_CREDENTIAL_IN_USE');
  assert.equal(json(inUse).details.usages.length, 1);
  assert.equal(json(inUse).details.usages[0].type, 'POLL_SCHEDULE');
  assert.equal(json(inUse).details.usages[0].deviceId, deviceId);
  assert.equal(json(inUse).details.usages[0].deviceName, 'HTTP Switch A2');
  assert.equal(json(inUse).details.usages[0].intervalMinutes, 15);
  assert.equal((await request('DELETE', credentialUrl('READ', '?force=false'), 'qa-admin')).statusCode, 409);
  const badForce = await request('DELETE', credentialUrl('READ', '?force=yes'), 'qa-admin');
  assert.equal(badForce.statusCode, 400);
  assert.equal(json(badForce).code, 'SNMP_FORCE_INVALID');
  assert.ok(await prisma.snmpCredential.findUnique({ where: { id: read.id } }), 'nothing deleted without force');

  // A queued or running job using the credential: refused even with force.
  const running = await prisma.snmpJob.create({ data: { deviceId, credentialId: read.id, type: 'POLL', status: 'RUNNING', startedAt: new Date() } });
  const busy = await request('DELETE', credentialUrl('READ', '?force=true'), 'qa-admin');
  assert.equal(busy.statusCode, 409, busy.body);
  assert.equal(json(busy).code, 'SNMP_CREDENTIAL_BUSY');
  assert.deepEqual(json(busy).details.jobs.map((job: { id: string; status: string }) => [job.id, job.status]), [[running.id, 'RUNNING']]);
  await prisma.snmpJob.update({ where: { id: running.id }, data: { status: 'PENDING', startedAt: null } });
  assert.equal(json(await request('DELETE', credentialUrl('READ', '?force=true'), 'qa-admin')).code, 'SNMP_CREDENTIAL_BUSY', 'queued counts too');
  assert.ok(await prisma.snmpCredential.findUnique({ where: { id: read.id } }));

  // A job stuck for longer than the 30-minute window no longer blocks; the forced delete is audited with the usages.
  await prisma.snmpJob.update({ where: { id: running.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
  const forced = await request('DELETE', credentialUrl('READ', '?force=true'), 'qa-admin');
  assert.equal(forced.statusCode, 200, forced.body);
  assert.equal(json(forced).forced, true);
  assert.equal(json(forced).usages[0].type, 'POLL_SCHEDULE');
  assert.equal(await prisma.snmpCredential.findUnique({ where: { id: read.id } }), null);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SNMP_CREDENTIAL_FORCE_DELETED', entityId: read.id } });
  assert.equal(audit.userId, ids.admin);
  assert.equal((audit.metadata as { forced: boolean }).forced, true);
  assert.equal((audit.metadata as { usages: Array<{ type: string }> }).usages[0].type, 'POLL_SCHEDULE');
  assert.equal((await prisma.snmpJob.findUniqueOrThrow({ where: { id: running.id } })).credentialId, null, 'job history kept, link cleared');

  // TRAP in use once the device has sent traps; WRITE in use while SNMP SET is enabled.
  await createCredential('TRAP');
  await prisma.snmpTrapEvent.create({ data: { deviceId, sourceAddress: '10.250.1.3', sourcePort: 162, version: 'V2C', authIdentity: 'http-f2', pduType: 'TRAP', varbinds: [], expiresAt: new Date(Date.now() + 86_400_000) } });
  const trapInUse = await request('DELETE', credentialUrl('TRAP'), 'qa-admin');
  assert.equal(trapInUse.statusCode, 409);
  assert.equal(json(trapInUse).details.usages[0].type, 'TRAP_VALIDATION');
  assert.ok(json(trapInUse).details.usages[0].lastTrapReceivedAt);
  assert.equal((await request('DELETE', credentialUrl('TRAP', '?force=true'), 'qa-admin')).statusCode, 200);
  await createCredential('WRITE');
  process.env.SNMP_SET_ENABLED = 'true';
  const writeInUse = await request('DELETE', credentialUrl('WRITE'), 'qa-admin');
  assert.equal(writeInUse.statusCode, 409);
  assert.equal(json(writeInUse).details.usages[0].type, 'SNMP_SET');
  delete process.env.SNMP_SET_ENABLED;
  assert.equal(json(await request('DELETE', credentialUrl('WRITE'), 'qa-admin')).forced, false);
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

test('pages older notifications, isolates users and tracks individual read state in the bell', async (context) => {
  const notifications = '/api/v1/notifications';
  const user = 'qa-readonly';
  const old = new Date('2025-09-01T08:00:00Z');
  const titlePrefix = 'Step 27 archive';
  const foreign = await prisma.notification.create({ data: { userId: ids.legacy, type: 'LIFECYCLE_DATE', title: `${titlePrefix} other`, message: 'Private' } });
  await prisma.notification.createMany({ data: Array.from({ length: 27 }, (_, index) => ({
    userId: ids.readonly, type: index === 0 ? 'ROLE_REQUEST_APPROVED' : 'LIFECYCLE_DATE',
    title: `${titlePrefix} ${index}`, message: 'Archived', createdAt: old,
  })) });
  context.after(() => prisma.notification.deleteMany({ where: { title: { startsWith: titlePrefix } } }).then(() => undefined));
  assert.equal((await request('GET', notifications)).statusCode, 401);
  assert.equal((await request('GET', `${notifications}?status=unknown`, user)).statusCode, 400);
  const page1 = json(await request('GET', `${notifications}?status=all`, user));
  assert.equal(page1.items.length, 25);
  assert.ok(page1.nextCursor);
  const page2 = json(await request('GET', `${notifications}?status=all&cursor=${page1.nextCursor}`, user));
  assert.equal(page2.items.length, 2);
  assert.equal(page2.nextCursor, null);
  const rows = [...page1.items, ...page2.items];
  assert.equal(new Set(rows.map((item) => item.id)).size, 27);
  assert.equal(rows.some((item) => item.id === foreign.id), false);
  assert.ok(rows.every((item) => item.createdAt === old.toISOString()));
  assert.equal(json(await request('GET', `${notifications}?type=ROLE_REQUEST`, user)).items.length, 1);

  const badge = async () => json(await request('GET', '/api/v1/dashboard/topbar-state', user)).notificationUnreadCount;
  assert.equal(await badge(), 27);
  assert.equal((await request('PATCH', `${notifications}/${foreign.id}/read`, user, { read: true })).statusCode, 404);
  assert.equal((await request('GET', `${notifications}?cursor=${foreign.id}`, user)).statusCode, 404);
  const id = page1.nextCursor;
  assert.equal((await request('PATCH', `${notifications}/${id}/read`, user, { read: true })).statusCode, 200);
  assert.equal(await badge(), 26);
  assert.equal((await prisma.notification.findFirstOrThrow({ where: { id: foreign.id } })).readAt, null);
  assert.equal(json(await request('GET', `${notifications}?status=unread&cursor=${id}`, user)).items.length, 2);
  assert.equal((await request('PATCH', `${notifications}/${id}/read`, user, { read: false })).statusCode, 200);
  assert.equal(await badge(), 27);
  assert.equal(json(await request('PATCH', '/api/v1/dashboard/notifications/read-all', user)).updated, 27);
  assert.equal(await badge(), 0);
  assert.deepEqual(json(await request('GET', `${notifications}?status=unread`, user)), { items: [], nextCursor: null });
});

test('persists per-user preferences and skips delivery for each muted notification topic', async (context) => {
  const root = '/api/v1/notifications/preferences';
  const muted = 'qa-readonly';
  const receiver = 'qa-auditor';
  const users = [ids.readonly, ids.auditor];
  const topics = ['ROLE_REQUEST', 'CRITICAL_ASSET_ATTESTATION', 'LIFECYCLE_DATE'];
  const due = new Date('2026-11-23T10:00:00Z');
  const group = await prisma.accessGroup.create({ data: { name: 'Step 27 recipients', members: { create: users.map((userId) => ({ userId })) } } });
  const device = await prisma.device.create({ data: { name: 'Step 27 notification device', type: 'SERVER', siteId: ids.siteB, isCritical: true } });
  await prisma.criticalAssetGroupMapping.create({ data: { siteId: ids.siteB, assetType: 'SERVER', groupId: group.id } });
  const date = await prisma.lifecycleDate.create({ data: { kind: 'SUPPORT', deviceId: device.id, dueDate: due, reminderDays: [0], responsibleGroupId: group.id } });
  const roleRequests = await Promise.all(users.map((userId) => prisma.roleRequest.create({ data: { userId, roles: ['SYSTEMS_OPERATOR'] } })));
  context.after(async () => {
    await prisma.notification.deleteMany({ where: { OR: [{ roleRequestId: { in: roleRequests.map((row) => row.id) } }, { sourceHref: { contains: device.id } }, { sourceHref: { contains: date.id } }] } });
    await prisma.roleRequest.deleteMany({ where: { id: { in: roleRequests.map((row) => row.id) } } });
    await prisma.notificationMute.deleteMany({ where: { userId: { in: users } } });
    await prisma.device.delete({ where: { id: device.id } });
    await prisma.accessGroup.delete({ where: { id: group.id } });
  });

  for (const topic of topics) {
    assert.equal((await request('PATCH', `${root}/${topic}`, muted, { muted: true })).statusCode, 200);
  }
  assert.equal((await request('GET', root)).statusCode, 401);
  assert.deepEqual(json(await request('GET', root, muted)).map((item: { muted: boolean }) => item.muted), [true, true, true]);
  assert.deepEqual(json(await request('GET', root, receiver)).map((item: { muted: boolean }) => item.muted), [false, false, false]);
  for (const item of roleRequests) {
    assert.equal((await request('PATCH', `/api/v1/settings/role-requests/${item.id}`, 'qa-admin', { decision: 'REJECT' })).statusCode, 200);
  }
  await app.get(CriticalAssetsService).runWeeklyChecks(due);
  await deliverLifecycleReminders(prisma, due);
  const inbox = async (persona: string) => json(await request('GET', '/api/v1/notifications', persona)).items;
  // Muted topics silence incoming notices, but the requester's own role-request outcome always reaches them.
  assert.deepEqual((await inbox(muted)).map((item: { type: string }) => item.type), ['ROLE_REQUEST_REJECTED']);
  const received = await inbox(receiver);
  assert.deepEqual(received.map((item: { type: string }) => item.type).sort(), ['CRITICAL_ASSET_ATTESTATION', 'LIFECYCLE_DATE', 'ROLE_REQUEST_REJECTED']);
  assert.ok(received.find((item: { type: string }) => item.type === 'LIFECYCLE_DATE').href.includes(`lifecycleId=${date.id}`));
  assert.ok(received.find((item: { type: string }) => item.type === 'CRITICAL_ASSET_ATTESTATION').href.includes(`assetId=${device.id}`));
  assert.ok(received.find((item: { type: string }) => item.type === 'ROLE_REQUEST_REJECTED').href.endsWith(`&requestId=${roleRequests[1].id}`));

  assert.equal((await request('PATCH', `${root}/ROLE_REQUEST`, muted, { muted: false })).statusCode, 200);
  const newRequest = await prisma.roleRequest.create({ data: { userId: ids.readonly, roles: ['AUDITOR'] } });
  roleRequests.push(newRequest);
  assert.equal((await request('PATCH', `/api/v1/settings/role-requests/${newRequest.id}`, 'qa-admin', { decision: 'REJECT' })).statusCode, 200);
  assert.equal((await inbox(muted)).length, 2);
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

  // Step 12: rack power summary (capacity vs estimated draw, near-limit PDUs/devices, thresholds 80/90 by default)
  const summaryRes = await request('GET', `/api/v1/racks/${rackId}/power-summary`, admin);
  assert.equal(summaryRes.statusCode, 200, summaryRes.body);
  const summary = json(summaryRes);
  assert.deepEqual([summary.rack.id, summary.rack.roomName, summary.mode, summary.level], [rackId, 'HTTP Room A', 'SUPPLIER_AND_UPS', 'ok']);
  assert.deepEqual(summary.thresholds, { warningPercent: 80, criticalPercent: 90 });
  assert.deepEqual(summary.capacity, { watts: 7360, bySource: { SUPPLIER: 3680, UPS: 3680 }, missingBudgetPduIds: [] });
  assert.deepEqual(summary.draw, { estimatedWatts: 720, bySource: { SUPPLIER: 360, UPS: 360 }, worstFailoverWatts: 720 });
  assert.deepEqual(summary.utilisation, { bySource: { SUPPLIER: 9.8, UPS: 9.8 }, worstFailoverPercent: 19.6 });
  assert.deepEqual([summary.outlets.used, summary.outlets.total], [6, 64]);
  assert.deepEqual([summary.devices.total, summary.devices.connected, summary.devices.unconnected, summary.devices.nonRedundant], [3, 3, [], []]);
  assert.deepEqual(summary.nearLimit, { pdus: [], devices: [] });
  // Tighter thresholds: failover 19.6 % >= 19 % is critical, watts 9.8 % and outlets 3/32 = 9.4 % are warnings, so every device is near the limit
  const tight = json(await request('GET', `/api/v1/racks/${rackId}/power-summary?warningPercent=9&criticalPercent=19`, admin));
  assert.equal(tight.level, 'critical');
  assert.deepEqual(tight.nearLimit.pdus.map((p: any) => [p.source, p.level, p.reasons]), [['SUPPLIER', 'critical', ['watts', 'failoverWatts', 'outlets']], ['UPS', 'critical', ['watts', 'failoverWatts', 'outlets']]]);
  assert.deepEqual(tight.nearLimit.devices.map((d: any) => [d.name, d.estimatedWatts]), [['PWR Server', 400], ['PWR Firewall', 200], ['PWR Switch', 120]]);
  for (const query of ['warningPercent=90&criticalPercent=80', 'warningPercent=abc', 'criticalPercent=500']) {
    const bad = await request('GET', `/api/v1/racks/${rackId}/power-summary?${query}`, admin);
    assert.equal(bad.statusCode, 400, query);
    assert.equal(json(bad).code, 'POWER_THRESHOLD_INVALID');
  }
  assert.equal((await request('GET', '/api/v1/racks/99999999-0000-4000-8000-000000000000/power-summary', admin)).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/racks/${ids.rackSibling}/power-summary`, 'qa-systems-scoped')).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/racks/${rackId}/power-summary`, 'qa-systems-scoped')).statusCode, 200);
  // Site roll-up: worst first, only racks the user can read
  const siteSummary = json(await request('GET', `/api/v1/sites/${ids.siteA}/power-summary?warningPercent=9&criticalPercent=19`, admin));
  assert.equal(siteSummary.racks[0].rack.id, rackId);
  assert.ok(siteSummary.racks.some((r: any) => r.rack.id === ids.rackSibling));
  assert.equal(siteSummary.totals.racks, siteSummary.racks.length);
  assert.equal(siteSummary.totals.byLevel.critical, 1);
  assert.equal(siteSummary.truncated, false);
  const scopedSite = json(await request('GET', `/api/v1/sites/${ids.siteA}/power-summary`, 'qa-systems-scoped'));
  assert.ok(scopedSite.racks.some((r: any) => r.rack.id === rackId));
  assert.ok(!scopedSite.racks.some((r: any) => r.rack.id === ids.rackSibling));
  assert.equal((await request('GET', '/api/v1/sites/99999999-0000-4000-8000-000000000000/power-summary', admin)).statusCode, 404);

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
  // A move re-places the device: its (legacy) missing rear image is now required too, and filled power can't be dropped
  assert.deepEqual(json(refused).details.errors.map((e: any) => [e.config, e.reason, e.tab]), [['rearImage', 'MISSING', 'imagens'], ['power', 'CLEARED', 'energia']]);
  assert.equal((await prisma.device.findUnique({ where: { id: dev.sw } }))?.rackId, rackId);
  assert.equal(await prisma.pduOutletAssignment.count({ where: { deviceId: dev.sw } }), 2);
  // With the model's rear image and `power`, the move frees the old outlets and plugs into the new rack in one transaction
  const swRear = await prisma.assetFile.create({ data: { filename: 'pwr-sw-rear.png', storageKey: 'pwr-sw-rear.png', mimeType: 'image/png', sizeBytes: 1, kind: 'DEVICE_BACK' } });
  await prisma.deviceModel.update({ where: { id: model.id }, data: { backAssetId: swRear.id } });
  const moved = await request('PATCH', `/api/v1/devices/${dev.sw}`, admin, { ...moveBody, power: {} });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual(json(moved).requiredConfig.missing, []);
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
  assert.equal(registry.configs.some((c: any) => 'introducedAt' in c), false);
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

  // Site → rack: placing an unracked device is like creating it in the rack (rear image + power required)
  const unracked = await request('POST', '/api/v1/devices', admin, { name: 'RC Site Only', type: 'SERVER', siteId: ids.siteA });
  assert.equal(unracked.statusCode, 201, unracked.body);
  assert.equal(json(unracked).requiredConfig.complete, true);
  const placeBody = { name: 'RC Site Only', type: 'SERVER', siteId: ids.siteA, rackId: rack.id, rackUnitStart: 14, rackUnitSize: 1 };
  const placeRefused = await request('PATCH', `/api/v1/devices/${json(unracked).id}`, admin, placeBody);
  assert.equal(placeRefused.statusCode, 400, placeRefused.body);
  assert.deepEqual(json(placeRefused).details.errors.map((e: any) => [e.config, e.reason]), [['rearImage', 'MISSING'], ['power', 'MISSING']]);
  const placeNoPower = await request('PATCH', `/api/v1/devices/${json(unracked).id}`, admin, { ...placeBody, modelId: rcModel.id });
  assert.equal(placeNoPower.statusCode, 400, placeNoPower.body);
  assert.deepEqual(json(placeNoPower).details.errors.map((e: any) => [e.config, e.reason, e.tab]), [['power', 'MISSING', 'energia']]);
  assert.equal((await prisma.device.findUnique({ where: { id: json(unracked).id } }))?.rackId, null);
  const placed = await request('PATCH', `/api/v1/devices/${json(unracked).id}`, admin, { ...placeBody, modelId: rcModel.id, power: {} });
  assert.equal(placed.statusCode, 200, placed.body);
  assert.equal(json(placed).requiredConfig.complete, true);
  const placedZero = await request('POST', '/api/v1/devices', admin, { name: 'RC Site Only 2', type: 'OTHER', siteId: ids.siteA });
  const zero = await request('PATCH', `/api/v1/devices/${json(placedZero).id}`, admin, { name: 'RC Site Only 2', type: 'OTHER', siteId: ids.siteA, rackId: rack.id, rackUnitStart: 15, rackUnitSize: 1, modelId: rcModel.id, powerPlugCount: 0 });
  assert.equal(zero.statusCode, 200, zero.body);

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
  assert.ok(powerAlert.siteCount >= 1);
  if (powerAlert.count > 1 && powerAlert.siteCount > 1) {
    assert.equal(powerAlert.href, '/infraestrutura?tab=devices&missingConfig=power&allSites=1');
    assert.ok(powerAlert.detail.endsWith(` — em ${powerAlert.siteCount} Sites.`), powerAlert.detail);
  } else assert.equal(powerAlert.href.includes('allSites'), false);

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

test('critical asset review notes: over 2000 characters is a 400 for single and bulk confirm, and a bulk batch with one such note writes nothing', async () => {
  const tooLong = 'x'.repeat(2001);
  const week = new Date('2026-11-16T00:00:00.000Z');
  const single = await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA, weekStart: week } });
  const valid = await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA2, weekStart: week } });
  const oversized = await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA, weekStart: new Date('2026-11-23T00:00:00.000Z') } });
  const outcomes = async () => (await prisma.criticalAssetAttestation.findMany({ where: { id: { in: [single.id, valid.id, oversized.id] } }, orderBy: { id: 'asc' } })).map((row) => row.outcome);
  try {
    const one = await request('POST', `/api/v1/critical-assets/${single.id}/confirm`, 'qa-admin', { outcome: 'NEEDS_CORRECTION', notes: tooLong });
    assert.equal(one.statusCode, 400, one.body);
    const batch = await request('POST', '/api/v1/critical-assets/confirm-bulk', 'qa-admin', { items: [
      { id: valid.id, outcome: 'CONFIRMED' },
      { id: oversized.id, outcome: 'NEEDS_CORRECTION', notes: tooLong },
    ] });
    assert.equal(batch.statusCode, 400, batch.body);
    assert.deepEqual(await outcomes(), [null, null, null], 'a rejected request writes nothing, not even the valid item');
    assert.equal(await prisma.criticalAssetCorrection.count({ where: { attestationId: { in: [single.id, oversized.id] } } }), 0);

    const exact = await request('POST', '/api/v1/critical-assets/confirm-bulk', 'qa-admin', { items: [{ id: valid.id, outcome: 'NEEDS_CORRECTION', notes: 'y'.repeat(2000) }] });
    assert.equal(exact.statusCode, 201, exact.body);
    assert.equal((await prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id: valid.id } })).outcome, 'NEEDS_CORRECTION', 'exactly 2000 characters is allowed');
  } finally {
    // Remove only the rows this test created, so the later per-device counts in this file are unchanged.
    const created = { attestationId: { in: [single.id, valid.id, oversized.id] } };
    await prisma.criticalAssetCorrection.deleteMany({ where: created });
    await prisma.criticalAssetAttestation.deleteMany({ where: { id: { in: [single.id, valid.id, oversized.id] } } });
  }
});

test('critical asset attestation: 409 on a second review of the same cycle, reviewer names and due state over HTTP', async () => {
  await prisma.user.update({ where: { id: ids.admin }, data: { displayName: 'QA Admin Person' } });
  await prisma.device.updateMany({ where: { id: { in: [ids.deviceA, ids.deviceA2] } }, data: { isCritical: true } });
  await prisma.criticalAssetGroupMapping.create({ data: { siteId: ids.siteA, assetType: 'SWITCH', groupId: ids.groupRead } });
  const pending = await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA, weekStart: new Date('2026-11-09T00:00:00.000Z') } });
  for (const week of ['2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05']) {
    await prisma.criticalAssetAttestation.create({ data: { siteId: ids.siteA, deviceId: ids.deviceA, weekStart: new Date(`${week}T00:00:00.000Z`), outcome: 'CONFIRMED', confirmedAt: new Date(`${week}T10:00:00.000Z`), confirmedBy: ids.scoped, notes: week === '2026-10-26' ? 'checked tag' : null } });
  }
  const first = await request('POST', `/api/v1/critical-assets/${pending.id}/confirm`, 'qa-admin', { outcome: 'NEEDS_CORRECTION', notes: 'Wrong serial' });
  assert.equal(first.statusCode, 201);
  assert.equal(json(first).confirmedByName, 'QA Admin Person');
  assert.equal(json(first).confirmedBy, ids.admin);
  const second = await request('POST', `/api/v1/critical-assets/${pending.id}/confirm`, 'qa-admin', { outcome: 'CONFIRMED' });
  assert.equal(second.statusCode, 409);
  const conflict = json(second);
  assert.equal(conflict.code, 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED');
  assert.match(conflict.message, /já foi registada por QA Admin Person/);
  assert.equal(conflict.details.outcome, 'NEEDS_CORRECTION');
  assert.equal(conflict.details.weekStart, '2026-11-09');
  const stored = await prisma.criticalAssetAttestation.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(stored.outcome, 'NEEDS_CORRECTION');
  assert.equal(stored.notes, 'Wrong serial');
  assert.equal(await prisma.auditLog.count({ where: { action: 'CRITICAL_ASSET_ATTESTATION_RECORDED', entityId: ids.deviceA } }), 1);

  const list = await request('GET', `/api/v1/critical-assets?siteId=${ids.siteA}`, 'qa-admin');
  assert.equal(list.statusCode, 200);
  const body = json(list);
  const switchA = body.assets.find((asset: { id: string }) => asset.id === ids.deviceA);
  assert.equal(switchA.attestations.length, 6);
  assert.equal(switchA.owner.id, ids.groupRead);
  assert.equal(switchA.latestOutcome, 'NEEDS_CORRECTION');
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
      request('POST', `/api/v1/critical-assets/${row.id}/confirm`, 'qa-admin', { outcome: 'NEEDS_CORRECTION', notes: 'second' }),
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

test('Device 360 lifecycle card: GET /lifecycle-dates by deviceId needs no range and the site calendar keeps its cap', async () => {
  const far = new Date('2045-06-30T00:00:00.000Z');
  const date = await prisma.lifecycleDate.create({ data: { deviceId: ids.deviceA, kind: 'D360_WARRANTY', dueDate: far } });
  try {
    // The old Device 360 call (100-year range, no deviceId) is still rejected: the calendar stays capped at 370 days.
    assert.equal((await request('GET', `/api/v1/lifecycle-dates?siteId=${ids.siteA}&from=2000-01-01&to=2100-01-01`, 'qa-admin')).statusCode, 400);
    assert.equal((await request('GET', `/api/v1/lifecycle-dates?siteId=${ids.siteA}`, 'qa-admin')).statusCode, 400);
    const response = await request('GET', `/api/v1/lifecycle-dates?siteId=${ids.siteA}&deviceId=${ids.deviceA}`, 'qa-admin');
    assert.equal(response.statusCode, 200, response.body);
    const items = json(response).items as Array<{ id: string; deviceId: string; dueDate: string }>;
    assert.ok(items.every((item) => item.deviceId === ids.deviceA));
    assert.equal(items.find((item) => item.id === date.id)?.dueDate, '2045-06-30');
    const other = json(await request('GET', `/api/v1/lifecycle-dates?siteId=${ids.siteA}&deviceId=${ids.deviceA2}`, 'qa-admin')).items as Array<{ id: string }>;
    assert.ok(!other.some((item) => item.id === date.id));
  } finally {
    await prisma.lifecycleDate.delete({ where: { id: date.id } });
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
  // Enum filters are validated (400) instead of reaching Prisma.
  for (const [path, code] of [['/api/v1/discovery/jobs?status=BOGUS', 'DISCOVERY_STATUS_INVALID'], ['/api/v1/ip-addresses?state=NOPE', 'IP_STATE_INVALID']]) {
    const response = await request('GET', path, 'qa-admin');
    assert.equal(response.statusCode, 400, `${path} ${response.body}`);
    assert.equal(json(response).code, code);
  }
  assert.equal((await request('GET', '/api/v1/discovery/jobs?status=completed', 'qa-admin')).statusCode, 200);
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

test('Discovery P0: the runs list filters by the active site and subnets keep their own scan load limits', async () => {
  const jobA = await prisma.discoveryJob.create({ data: { name: 'P0 site A run', subnetId: ids.subnetA, methods: ['ICMP'], tcpPorts: [], status: 'COMPLETED' } });
  const jobB = await prisma.discoveryJob.create({ data: { name: 'P0 site B run', subnetId: ids.subnetB, methods: ['ICMP'], tcpPorts: [], status: 'FAILED', errorMessage: 'DISCOVERY_TARGET_NOT_ALLOWED' } });
  try {
    const listed = (path: string) => request('GET', path, 'qa-admin').then((response) => { assert.equal(response.statusCode, 200, response.body); return json(response).items.map((item: { id: string }) => item.id) as string[]; });
    const all = await listed('/api/v1/discovery/jobs?pageSize=100');
    assert.ok(all.includes(jobA.id) && all.includes(jobB.id));
    const siteA = await listed(`/api/v1/discovery/jobs?pageSize=100&siteId=${ids.siteA}`);
    assert.ok(siteA.includes(jobA.id)); assert.equal(siteA.includes(jobB.id), false);
    const siteB = await listed(`/api/v1/discovery/jobs?pageSize=100&siteId=${ids.siteB}&status=FAILED`);
    assert.deepEqual(siteB.filter((id) => id === jobA.id || id === jobB.id), [jobB.id]);
    const invalid = await request('GET', '/api/v1/discovery/jobs?siteId=not-a-uuid', 'qa-admin');
    assert.equal(invalid.statusCode, 400, invalid.body); assert.equal(json(invalid).code, 'SITE_ID_INVALID');
    // The site filter narrows the caller's access; it never widens it.
    const scopedB = json(await request('GET', `/api/v1/discovery/jobs?pageSize=100&siteId=${ids.siteB}`, 'qa-network-scoped')).items.map((item: { id: string }) => item.id);
    assert.equal(scopedB.includes(jobB.id), false);

    // Defaults before anything is set.
    const defaults = json(await request('GET', '/api/v1/settings/discovery', 'qa-admin'));
    assert.deepEqual({ probesPerSecond: defaults.limits.probesPerSecond, maxSockets: defaults.limits.maxSockets }, { probesPerSecond: 100, maxSockets: 64 });
    const before = json(await request('GET', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-admin'));
    assert.deepEqual(before.limits, { probesPerSecond: null, maxSockets: null, effective: { probesPerSecond: 100, maxSockets: 64 } });
    const base = { enabled: false, methods: ['ICMP', 'TCP'], tcpPorts: [22, 443], intervalHours: 12, reverseDns: false };
    for (const bad of [{ probesPerSecond: 0 }, { probesPerSecond: 2001 }, { maxSockets: 0 }, { maxSockets: 1025 }, { maxSockets: 2.5 }]) {
      const response = await request('PATCH', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-admin', { ...base, ...bad });
      assert.equal(response.statusCode, 400, `${JSON.stringify(bad)} ${response.body}`);
    }
    assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-auditor', { ...base, probesPerSecond: 20 })).statusCode, 403);
    const saved = await request('PATCH', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-admin', { ...base, probesPerSecond: 20, maxSockets: 8 });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(json(saved).limits, { probesPerSecond: 20, maxSockets: 8, effective: { probesPerSecond: 20, maxSockets: 8 } });
    // Omitted keeps the stored values; null resets one to the default.
    const kept = json(await request('PATCH', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-admin', base));
    assert.deepEqual(kept.limits, { probesPerSecond: 20, maxSockets: 8, effective: { probesPerSecond: 20, maxSockets: 8 } });
    const reset = json(await request('PATCH', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-admin', { ...base, maxSockets: null }));
    assert.deepEqual(reset.limits, { probesPerSecond: 20, maxSockets: null, effective: { probesPerSecond: 20, maxSockets: 64 } });
    assert.deepEqual(json(await request('GET', `/api/v1/subnets/${ids.subnetA}/discovery-schedule`, 'qa-admin')).limits, reset.limits);
  } finally {
    await prisma.discoveryJob.deleteMany({ where: { id: { in: [jobA.id, jobB.id] } } });
    await prisma.subnet.update({ where: { id: ids.subnetA }, data: { discoveryProbesPerSecond: null, discoveryMaxSockets: null } });
    await prisma.discoverySchedule.deleteMany({ where: { subnetId: ids.subnetA } });
  }
});

test('Round 2 #6/#14 Desaparecidos: scoped list, Marcar livre per item with roles and validation, Qualidade rule', async () => {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const ipA = await prisma.ipAddress.create({ data: { subnetId: ids.subnetA, address: '10.250.1.233', state: 'OCCUPIED' } });
  const ipB = await prisma.ipAddress.create({ data: { subnetId: ids.subnetB, address: '10.250.2.233', state: 'OCCUPIED' } });
  await prisma.$executeRaw`UPDATE "IpAddress" SET "updatedAt" = now() - interval '10 days' WHERE "id" IN (${ipA.id}::uuid, ${ipB.id}::uuid)`;
  for (const subnetId of [ids.subnetA, ids.subnetB]) await prisma.discoveryJob.create({ data: { name: 'R2 missing scan', subnetId, methods: ['ICMP'], status: 'COMPLETED', startedAt: dayAgo, completedAt: new Date(dayAgo.getTime() + 30_000), createdAt: dayAgo } });

  const addresses = (response: { body: string }) => json(response).items.map((item: { address: string }) => item.address).filter((address: string) => address.endsWith('.233'));
  assert.deepEqual(addresses(await request('GET', '/api/v1/discovery/missing', 'qa-network-scoped')), ['10.250.1.233']);
  assert.deepEqual(addresses(await request('GET', `/api/v1/discovery/missing?subnetId=${ids.subnetB}`, 'qa-network-scoped')), []);
  assert.deepEqual(addresses(await request('GET', '/api/v1/discovery/missing', 'qa-admin')), ['10.250.1.233', '10.250.2.233']);
  assert.deepEqual(addresses(await request('GET', `/api/v1/discovery/missing?siteId=${ids.siteB}`, 'qa-admin')), ['10.250.2.233']);
  assert.equal((await request('GET', '/api/v1/discovery/missing?siteId=nope', 'qa-admin')).statusCode, 400);

  assert.equal((await request('POST', '/api/v1/discovery/missing/mark-free', 'qa-auditor', { ipIds: [ipA.id] })).statusCode, 403);
  for (const payload of [{ ipIds: [] }, { ipIds: [ipA.id, ipA.id] }, { ipIds: ['nope'] }, {}]) assert.equal((await request('POST', '/api/v1/discovery/missing/mark-free', 'qa-network-scoped', payload)).statusCode, 400, JSON.stringify(payload));

  const marked = await request('POST', '/api/v1/discovery/missing/mark-free', 'qa-network-scoped', { ipIds: [ipA.id, ipB.id] });
  assert.equal(marked.statusCode, 201, marked.body);
  const body = json(marked);
  assert.deepEqual(body.results.map((item: { ipId: string; ok: boolean }) => [item.ipId, item.ok]), [[ipA.id, true], [ipB.id, false]]);
  assert.ok(['FORBIDDEN', 'NOT_FOUND'].includes(body.results[1].code));
  assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: ipA.id } })).state, 'FREE');
  assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: ipB.id } })).state, 'OCCUPIED');
  assert.equal(await prisma.auditLog.count({ where: { action: 'IP_ADDRESS_MARKED_FREE', entityId: ipA.id, userId: ids.scoped } }), 1);
  const again = json(await request('POST', '/api/v1/discovery/missing/mark-free', 'qa-network-scoped', { ipIds: [ipA.id] }));
  assert.deepEqual(again.results.map((item: { code: string }) => item.code), ['NOT_MISSING']);

  // Qualidade: the address still missing appears as an IP_OCCUPIED_NOT_SEEN finding with a link to IPAM.
  assert.equal((await request('POST', '/api/v1/inventory-quality/reconcile', 'qa-admin', {})).statusCode, 201);
  const findings = json(await request('GET', '/api/v1/inventory-quality/findings?rule=IP_OCCUPIED_NOT_SEEN&pageSize=100', 'qa-admin'));
  const finding = findings.items.find((item: { entityId: string }) => item.entityId === ipB.id);
  assert.ok(finding, 'missing IP finding');
  assert.equal(finding.severity, 'WARNING');
  assert.equal(finding.actionHref, `/ipam?siteId=${ids.siteB}&subnetId=${ids.subnetB}&ipId=${ipB.id}`);
  assert.equal(findings.items.some((item: { entityId: string }) => item.entityId === ipA.id), false);
});

test('Round 2 #6/#14 + #11: a scan stopped at a limit is not coverage for Desaparecidos, mark-free or free-but-reachable', async () => {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
  const scan = (subnetId: string, daysAgo: number, stopReason: 'LIMIT_DURATION' | 'LIMIT_PROBES' | null) => prisma.discoveryJob.create({ data: { name: 'R2 partial coverage', subnetId, methods: ['ICMP'], status: 'COMPLETED', stopReason, startedAt: at(daysAgo), completedAt: new Date(at(daysAgo).getTime() + 30_000), createdAt: at(daysAgo) } });
  const [partialOnly, mixed] = await Promise.all(['10.250.12.0/28', '10.250.13.0/28'].map((cidr) => prisma.subnet.create({ data: { cidr, version: 4, siteId: ids.siteA } })));
  const occupied = await prisma.ipAddress.create({ data: { subnetId: partialOnly.id, address: '10.250.12.5', state: 'OCCUPIED' } });
  const free = await prisma.ipAddress.create({ data: { subnetId: mixed.id, address: '10.250.13.6', state: 'FREE' } });
  await prisma.$executeRaw`UPDATE "IpAddress" SET "updatedAt" = now() - interval '10 days' WHERE "id" IN (${occupied.id}::uuid, ${free.id}::uuid)`;
  // Subnet 1: two scans after the record changed, both stopped at a limit before reaching .5 (no result for it).
  await scan(partialOnly.id, 2, 'LIMIT_PROBES');
  await scan(partialOnly.id, 1, 'LIMIT_DURATION');
  // Subnet 2: a full scan saw the FREE address answer; a newer scan stopped at a limit before reaching it.
  const full = await scan(mixed.id, 3, null);
  await prisma.discoveryResult.create({ data: { jobId: full.id, address: free.address, icmpReachable: true, openPorts: [] } });
  await scan(mixed.id, 1, 'LIMIT_DURATION');

  const missing = async () => json(await request('GET', `/api/v1/discovery/missing?subnetId=${partialOnly.id}`, 'qa-admin')).items.map((item: { address: string }) => item.address);
  assert.deepEqual(await missing(), [], 'partial scans alone do not make an address Desaparecido');
  const refused = await request('POST', '/api/v1/discovery/missing/mark-free', 'qa-admin', { ipIds: [occupied.id] });
  assert.equal(refused.statusCode, 201, refused.body);
  assert.deepEqual(json(refused).results.map((item: { ok: boolean; code: string }) => [item.ok, item.code]), [[false, 'NOT_MISSING']]);
  assert.equal((await prisma.ipAddress.findUniqueOrThrow({ where: { id: occupied.id } })).state, 'OCCUPIED');

  const findings = async (rule: string) => {
    assert.equal((await request('POST', '/api/v1/inventory-quality/reconcile', 'qa-admin', {})).statusCode, 201);
    return json(await request('GET', `/api/v1/inventory-quality/findings?rule=${rule}&pageSize=100`, 'qa-admin')).items.map((item: { entityId: string }) => item.entityId);
  };
  assert.equal((await findings('IP_OCCUPIED_NOT_SEEN')).includes(occupied.id), false);
  // The latest FULL scan decides free-but-reachable; the newer partial scan never reached the address and does not hide it.
  assert.equal((await findings('IP_FREE_BUT_REACHABLE')).includes(free.id), true);

  // Control: one full scan of subnet 1 is coverage, so the address becomes missing and can be freed.
  await scan(partialOnly.id, 0.5, null);
  assert.deepEqual(await missing(), ['10.250.12.5']);
  assert.equal((await findings('IP_OCCUPIED_NOT_SEEN')).includes(occupied.id), true);
  const freed = json(await request('POST', '/api/v1/discovery/missing/mark-free', 'qa-admin', { ipIds: [occupied.id] }));
  assert.deepEqual(freed.results.map((item: { ok: boolean }) => item.ok), [true]);
  await prisma.subnet.deleteMany({ where: { id: { in: [partialOnly.id, mixed.id] } } });
});

test('Round 2 #10/#11 discovery: cancel queued and running scans, retry a failed scan, limits are validated', async () => {
  const subnet = await prisma.subnet.create({ data: { cidr: '10.250.9.0/28', version: 4, siteId: ids.siteA } });
  const invalid = await request('POST', '/api/v1/discovery/jobs', 'qa-admin', { name: 'R2 limits', subnetId: subnet.id, methods: ['ICMP'], maxDurationSeconds: 5 });
  assert.equal(invalid.statusCode, 400, invalid.body);
  const created = await request('POST', '/api/v1/discovery/jobs', 'qa-admin', { name: 'R2 cancel queued', subnetId: subnet.id, methods: ['ICMP'], maxDurationSeconds: 120, maxProbes: 10 });
  assert.equal(created.statusCode, 201, created.body);
  const queued = json(created);
  assert.deepEqual([queued.status, queued.maxDurationSeconds, queued.maxProbes], ['PENDING', 120, 10]);
  assert.equal((await request('POST', `/api/v1/discovery/jobs/${queued.id}/cancel`, 'qa-auditor')).statusCode, 403);
  const cancelled = await request('POST', `/api/v1/discovery/jobs/${queued.id}/cancel`, 'qa-network-scoped');
  assert.equal(cancelled.statusCode, 201, cancelled.body);
  assert.deepEqual([json(cancelled).status, json(cancelled).stopReason], ['CANCELLED', 'CANCELLED']);
  const again = await request('POST', `/api/v1/discovery/jobs/${queued.id}/cancel`, 'qa-network-scoped');
  assert.equal(again.statusCode, 409); assert.equal(json(again).code, 'DISCOVERY_NOT_ACTIVE');
  assert.ok(json(await request('GET', '/api/v1/discovery/jobs?status=CANCELLED', 'qa-admin')).items.some((item: { id: string }) => item.id === queued.id));

  const running = await prisma.discoveryJob.create({ data: { name: 'R2 running', subnetId: subnet.id, methods: ['ICMP'], tcpPorts: [], status: 'RUNNING', startedAt: new Date() } });
  const requested = await request('POST', `/api/v1/discovery/jobs/${running.id}/cancel`, 'qa-network-scoped');
  assert.equal(requested.statusCode, 201, requested.body);
  assert.equal(json(requested).status, 'RUNNING', 'a running scan stops at its next batch');
  assert.ok(json(requested).cancelRequestedAt);
  await prisma.discoveryJob.update({ where: { id: running.id }, data: { status: 'FAILED', completedAt: new Date(), errorMessage: 'ECONNRESET' } });

  const busy = await prisma.discoveryJob.create({ data: { name: 'R2 busy', subnetId: subnet.id, methods: ['ICMP'], tcpPorts: [], status: 'PENDING' } });
  const blocked = await request('POST', `/api/v1/discovery/jobs/${running.id}/retry`, 'qa-network-scoped');
  assert.equal(blocked.statusCode, 409); assert.equal(json(blocked).code, 'DISCOVERY_ALREADY_ACTIVE');
  assert.equal((await prisma.discoveryJob.findUniqueOrThrow({ where: { id: running.id } })).status, 'FAILED');
  await prisma.discoveryJob.delete({ where: { id: busy.id } });
  const retried = await request('POST', `/api/v1/discovery/jobs/${running.id}/retry`, 'qa-network-scoped');
  assert.equal(retried.statusCode, 201, retried.body);
  assert.deepEqual([json(retried).status, json(retried).errorMessage], ['PENDING', null]);
  const twice = await request('POST', `/api/v1/discovery/jobs/${running.id}/retry`, 'qa-network-scoped');
  assert.equal(twice.statusCode, 409); assert.equal(json(twice).code, 'DISCOVERY_NOT_RETRYABLE');
  await prisma.subnet.delete({ where: { id: subnet.id } });
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

test('Step 20 audit: reads are not audited and search skips HTTP_REQUEST rows', async () => {
  // A GET is not written to AuditLog, so its URL cannot later match the search that issued it.
  const term = 'step20probe';
  const before = await prisma.auditLog.count({ where: { action: { contains: term } } });
  assert.equal((await request('GET', `/api/v1/dashboard/search?q=${term}&types=AUDIT_EVENT`, 'qa-auditor')).statusCode, 200);
  assert.equal(await prisma.auditLog.count({ where: { action: { contains: term } } }), before);

  // Rows that are HTTP_REQUEST never appear as AUDIT_EVENT results, even when the term matches their action.
  await prisma.auditLog.create({ data: { userId: ids.admin, action: 'POST /api/v1/step20probe-http', entityType: 'HTTP_REQUEST', metadata: { statusCode: 201 } } });
  await prisma.auditLog.create({ data: { userId: ids.admin, action: 'STEP20_PROBE_EVENT', entityType: 'Device', entityId: ids.deviceA } });
  const hits = json(await request('GET', `/api/v1/dashboard/search?q=${term}&types=AUDIT_EVENT`, 'qa-auditor')).items as Array<{ title: string }>;
  assert.deepEqual(hits.map((item) => item.title), []);
  const events = json(await request('GET', '/api/v1/dashboard/search?q=STEP20_PROBE&types=AUDIT_EVENT', 'qa-auditor')).items as Array<{ title: string }>;
  assert.deepEqual(events.map((item) => item.title), ['STEP20_PROBE_EVENT']);
});

test('Step 20 export trail: sensitive exports write explicit audit events', async () => {
  const term = 'step20exportprobe';
  await prisma.auditLog.create({ data: { userId: ids.admin, action: term, entityType: 'Device', entityId: ids.deviceA } });

  // The audit CSV export is a GET, so it must leave its own explicit row (no HTTP_REQUEST-only trace).
  const csv = await request('GET', `/api/v1/audit/events/export?action=${term}`, 'qa-auditor');
  assert.equal(csv.statusCode, 200, csv.body);
  const exported = await prisma.auditLog.findFirst({ where: { action: 'AUDIT_EVENTS_EXPORTED', userId: ids.auditor }, orderBy: { createdAt: 'desc' } });
  assert.ok(exported, 'AUDIT_EVENTS_EXPORTED row missing');
  const metadata = exported.metadata as { filters: Record<string, unknown>; rowCount: number; truncated: boolean };
  assert.equal(metadata.filters.action, term);
  assert.equal(metadata.rowCount, 1);
  assert.equal(metadata.truncated, false);

  // Ansible inventory export and an explicit data export each record their own event.
  assert.equal((await request('GET', '/api/v1/exports/ansible', 'qa-auditor')).statusCode, 200);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'ANSIBLE_INVENTORY_EXPORTED', userId: ids.auditor } }), 'ANSIBLE_INVENTORY_EXPORTED row missing');
  assert.equal((await request('GET', '/api/v1/exports/devices/csv', 'qa-auditor')).statusCode, 200);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: 'DATA_EXPORTED', userId: ids.auditor, entityType: 'Export' } }), 'DATA_EXPORTED row missing');
});

test('Phase E portal: favourites, check-all link health and the pending role-request queue', async () => {
  const server = createServer((req, res) => { res.statusCode = req.url === '/down' ? 503 : 200; res.end(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const previousAllowed = process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS;
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
    // Loopback is blocked by default; the stand-in is only reachable once an operator allows it.
    delete process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS;
    const blockedRun = json(await request('POST', '/api/v1/application-links/check-all', 'qa-admin'));
    assert.equal(blockedRun.checked, 2); assert.equal(blockedRun.blocked, 2); assert.equal(blockedRun.available, 0);
    assert.deepEqual(blockedRun.items.map((item: { code: string }) => item.code), ['BLOCKED', 'BLOCKED']);
    const metadata = await prisma.applicationLink.create({ data: { name: 'Phase E metadata', url: 'http://169.254.169.254/latest/meta-data/', checkAvailability: true } });
    process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS = '127.0.0.1/32';
    const withMetadata = json(await request('POST', '/api/v1/application-links/check-all', 'qa-admin'));
    assert.equal(withMetadata.items.find((item: { id: string }) => item.id === metadata.id).code, 'BLOCKED');
    assert.equal(withMetadata.nextOffset, null);
    assert.equal((await request('POST', '/api/v1/application-links/check-all?offset=-1', 'qa-admin')).statusCode, 400);
    await prisma.applicationLink.delete({ where: { id: metadata.id } });
    const checked = await request('POST', '/api/v1/application-links/check-all', 'qa-admin');
    assert.equal(checked.statusCode, 201, checked.body);
    const checkedBody = json(checked);
    assert.equal(checkedBody.scope, 'CHECK_AVAILABILITY');
    assert.equal(checkedBody.checked, 2); assert.equal(checkedBody.available, 1); assert.equal(checkedBody.unavailable, 1);
    assert.equal((await prisma.applicationLink.findUniqueOrThrow({ where: { id: down.id } })).isAvailable, false);
    assert.equal((await prisma.applicationLink.findUniqueOrThrow({ where: { id: up.id } })).isAvailable, true);
    assert.equal(json(await request('POST', '/api/v1/application-links/check-all?all=true', 'qa-admin')).checked, 3);
  } finally {
    if (previousAllowed === undefined) delete process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS; else process.env.APPLICATION_LINK_CHECK_ALLOWED_CIDRS = previousAllowed;
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

test('Step 16 NetApp trend: each refresh appends history, trend per aggregate/volume, retention prune, Site isolation', async () => {
  const integration = await prisma.netAppIntegration.create({ data: { siteId: ids.siteA, endpointUrl: 'https://ontap.http-qa.example', username: 'reader', ...encryptCredential({ password: 'ontap-pw' }, testKeyring) } });
  const DAY = 86_400_000;
  // Old samples: one past the 400-day retention (pruned on the next refresh) and two inside the window.
  const old = await prisma.netAppCapacitySample.create({ data: { integrationId: integration.id, kind: 'AGGREGATE', objectKey: 'aggr-uuid-1', name: 'aggr1', sizeBytes: 1000n, usedBytes: 100n, observedAt: new Date(Date.now() - 401 * DAY) } });
  await prisma.netAppCapacitySample.createMany({ data: [
    { integrationId: integration.id, kind: 'AGGREGATE', objectKey: 'aggr-uuid-1', name: 'aggr1', sizeBytes: 1000n, usedBytes: 300n, observedAt: new Date(Date.now() - 2 * DAY) },
    { integrationId: integration.id, kind: 'AGGREGATE', objectKey: 'aggr-uuid-1', name: 'aggr1', sizeBytes: 1000n, usedBytes: 350n, observedAt: new Date(Date.now() - 1 * DAY) },
  ] });
  let used = 400;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = String(input);
    const body = url.includes('/api/cluster?') ? { name: 'qa-cluster', uuid: 'c-1' }
      : url.includes('/cluster/nodes') ? { records: [{ name: 'node1', health: true }] }
      : url.includes('/storage/aggregates') ? { records: [{ name: 'aggr1', uuid: 'aggr-uuid-1', state: 'online', space: { block_storage: { size: 1000, used } } }] }
      : { records: [{ name: 'vol1', uuid: 'vol-uuid-1', state: 'online', svm: { name: 'svm1' }, space: { size: 200, used: 20 } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const first = await request('POST', `/api/v1/netapp/sites/${ids.siteA}/refresh`, 'qa-admin');
    assert.equal(first.statusCode, 201, first.body);
    used = 450;
    assert.equal((await request('POST', `/api/v1/netapp/sites/${ids.siteA}/refresh`, 'qa-admin')).statusCode, 201);
  } finally { globalThis.fetch = originalFetch; }

  // Current-snapshot behaviour is unchanged: GET still returns the latest snapshot.
  const current = json(await request('GET', `/api/v1/netapp/sites/${ids.siteA}`, 'qa-readonly'));
  assert.equal(current.snapshot.aggregates[0].usedBytes, 450);
  // Two refreshes × (cluster + aggregate + volume), plus the two in-window seeds; the 401-day-old row is pruned.
  assert.equal(await prisma.netAppCapacitySample.count({ where: { integrationId: integration.id } }), 8);
  assert.equal(await prisma.netAppCapacitySample.findUnique({ where: { id: old.id } }), null);

  const trendResponse = await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend?kind=AGGREGATE&key=aggr-uuid-1&days=30`, 'qa-readonly');
  assert.equal(trendResponse.statusCode, 200, trendResponse.body);
  const trend = json(trendResponse);
  // One point per day: today's two refreshes collapse to the later one (450).
  assert.deepEqual(trend.points.map((point: { usedBytes: number }) => point.usedBytes), [300, 350, 450]);
  assert.equal(trend.name, 'aggr1');
  assert.equal(trend.retentionDays, 400);
  assert.ok(trend.summary.growthBytesPerDay > 0);
  assert.ok(trend.summary.projectedFullAt);
  const cluster = json(await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend`, 'qa-readonly'));
  assert.equal(cluster.kind, 'CLUSTER');
  assert.equal(cluster.points.at(-1).usedBytes, 450);
  const volumes = json(await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend/objects?kind=VOLUME`, 'qa-readonly'));
  assert.deepEqual(volumes.items.map((item: { key: string; svm: string; usedPercent: number }) => [item.key, item.svm, item.usedPercent]), [['vol-uuid-1', 'svm1', 10]]);
  const aggregates = json(await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend/objects?kind=AGGREGATE&days=30`, 'qa-readonly'));
  assert.equal(aggregates.items[0].changeBytes, 150);

  assert.equal((await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend?kind=VOLUME`, 'qa-readonly')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend?kind=DISK&key=x`, 'qa-readonly')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend?days=401`, 'qa-readonly')).statusCode, 400);
  assert.equal((await request('GET', `/api/v1/netapp/sites/${ids.siteB}/trend`, 'qa-admin')).statusCode, 404);
  assert.equal((await request('GET', `/api/v1/netapp/sites/${ids.siteA}/trend`, 'qa-network-legacy')).statusCode, 404);
});

// ----- Step 31: Microsoft Teams delivery -----
const TEAMS_URL = 'https://contoso.webhook.office.com/webhookb2/step31-secret-token/IncomingWebhook/abc/def';
const TEAMS_ALERTS_URL = 'https://prod-01.westeurope.logic.azure.com/workflows/step31-alerts-secret/triggers/manual/paths/invoke?sig=step31-sig';
const SECRET_PARTS = ['step31-secret-token', 'step31-alerts-secret', 'step31-sig'];
const assertNoSecret = (label: string, text: string) => { for (const part of SECRET_PARTS) assert.ok(!text.includes(part), `${label} leaked a webhook secret`); };
type TeamsCall = { url: string; body: any; at: number };
function mockTeams(statusFor: (call: TeamsCall) => number | 'network') {
  const calls: TeamsCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body ?? '{}')), at: Date.now() };
    calls.push(call);
    const status = statusFor(call);
    if (status === 'network') throw new TypeError(`fetch failed: ${call.url}`);
    return new Response(status < 300 ? '1' : 'error', { status });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}
async function cleanTeams() {
  await prisma.notificationDelivery.deleteMany({});
  await prisma.notificationChannelPreference.deleteMany({});
  await prisma.deliveryChannelConfig.deleteMany({});
  await prisma.user.updateMany({ where: { id: { in: [ids.admin, ids.readonly, ids.auditor] } }, data: { email: null } });
}

test('Step 31: ADMIN Teams settings start off, store the webhook encrypted and never return or log it', async (context) => {
  context.after(cleanTeams);
  await cleanTeams();
  const root = '/api/v1/settings/notification-channels';
  const initial = json(await request('GET', root, 'qa-admin'));
  assert.deepEqual(initial.channels.map((item: any) => [item.kind, item.target, item.enabled, item.configured]), [
    ['TEAMS', 'USER_NOTIFICATIONS', false, false], ['TEAMS', 'GROUP_ALERTS', false, false], ['EMAIL', 'USER_NOTIFICATIONS', false, false], ['EMAIL', 'GROUP_ALERTS', false, false],
  ], 'every channel starts off');
  assert.equal(initial.keyringAvailable, true);
  assert.equal((await request('GET', root, 'qa-auditor')).statusCode, 403);
  assert.equal((await request('PUT', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-network-scoped', { enabled: true, webhookUrl: TEAMS_URL })).statusCode, 403);

  const invalid = await request('PUT', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, webhookUrl: 'https://evil.example/step31-secret-token' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(json(invalid).code, 'TEAMS_WEBHOOK_INVALID');
  assertNoSecret('invalid URL response', invalid.body);
  const notConfigured = await request('PUT', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true });
  assert.equal(notConfigured.statusCode, 409);
  assert.equal((await request('PUT', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, webhookUrl: TEAMS_URL, minSeverity: 'HIGH' })).statusCode, 400, 'minSeverity is for the group channel only');

  const saved = await request('PUT', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, webhookUrl: TEAMS_URL });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual([json(saved).enabled, json(saved).configured], [true, true]);
  assertNoSecret('save response', saved.body);
  const group = await request('PUT', `${root}/TEAMS/GROUP_ALERTS`, 'qa-admin', { enabled: false, webhookUrl: TEAMS_ALERTS_URL, minSeverity: 'CRITICAL' });
  assert.equal(json(group).minSeverity, 'CRITICAL');
  // Re-saving without a URL keeps the stored one.
  assert.equal(json(await request('PUT', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true })).configured, true);
  const listed = await request('GET', root, 'qa-admin');
  assertNoSecret('channel list', listed.body);

  const stored = await prisma.deliveryChannelConfig.findMany();
  for (const row of stored) assertNoSecret('stored ciphertext', Buffer.from(row.ciphertext!).toString('latin1') + JSON.stringify({ ...row, ciphertext: undefined }));
  const audit = await prisma.auditLog.findMany({ where: { action: { contains: 'NOTIFICATION_CHANNEL' } } });
  assert.ok(audit.length >= 3);
  assertNoSecret('audit log', JSON.stringify(await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })));

  const cleared = await request('DELETE', `${root}/TEAMS/USER_NOTIFICATIONS`, 'qa-admin');
  assert.deepEqual([json(cleared).enabled, json(cleared).configured], [false, false]);
});

test('Step 31: the test button sends one message, logs success or the failure reason, and failures can be retried', async (context) => {
  await cleanTeams();
  const service = app.get(NotificationDeliveryService);
  let status: number | 'network' = 200;
  const teams = mockTeams(() => status);
  context.after(async () => { teams.restore(); await cleanTeams(); });
  const root = '/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS';
  assert.equal((await request('POST', `${root}/test`, 'qa-admin')).statusCode, 409, 'cannot test before a URL is saved');
  await request('PUT', root, 'qa-admin', { enabled: false, webhookUrl: TEAMS_ALERTS_URL });

  const ok = await request('POST', `${root}/test`, 'qa-admin');
  assert.equal(ok.statusCode, 201, ok.body);
  assert.deepEqual([json(ok).status, json(ok).failureReason], ['SENT', null]);
  assert.equal(teams.calls.length, 1);
  assert.equal(teams.calls[0].url, TEAMS_ALERTS_URL);
  assert.equal(teams.calls[0].body.attachments[0].content.body[0].text, 'Mensagem de teste');

  status = 'network';
  const failed = await request('POST', `${root}/test`, 'qa-admin');
  assert.deepEqual([json(failed).status, json(failed).failureReason], ['FAILED', 'NETWORK_ERROR']);
  assertNoSecret('test failure response', failed.body);

  const log = await request('GET', '/api/v1/settings/notification-deliveries', 'qa-admin');
  assert.equal(log.statusCode, 200);
  assert.deepEqual(json(log).items.map((item: any) => [item.topic, item.status, item.failureReason]), [['TEST', 'FAILED', 'NETWORK_ERROR'], ['TEST', 'SENT', null]]);
  assert.deepEqual([json(log).counts.SENT, json(log).counts.FAILED], [1, 1]);
  assertNoSecret('delivery log', log.body);
  assert.equal((await request('GET', '/api/v1/settings/notification-deliveries', 'qa-readonly')).statusCode, 403);
  assert.equal(json(await request('GET', '/api/v1/settings/notification-deliveries?status=FAILED', 'qa-admin')).items.length, 1);

  status = 200;
  const failedId = json(failed).deliveryId;
  assert.equal((await request('POST', `/api/v1/settings/notification-deliveries/${json(ok).deliveryId}/retry`, 'qa-admin')).statusCode, 409, 'only failed deliveries can be retried');
  const retried = await request('POST', `/api/v1/settings/notification-deliveries/${failedId}/retry`, 'qa-admin');
  assert.equal(retried.statusCode, 201, retried.body);
  await service.kick();
  const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: failedId } });
  assert.deepEqual([row.status, row.attempts, row.failureReason], ['SENT', 2, null], 'a manual retry keeps counting attempts');

  // Manual retry never resets the bound: after 5 automatic attempts each press gives one more, up to 10 in total.
  status = 503;
  await prisma.notificationDelivery.update({ where: { id: failedId }, data: { status: 'FAILED', attempts: 5, failureReason: 'HTTP_503' } });
  assert.equal((await request('POST', `/api/v1/settings/notification-deliveries/${failedId}/retry`, 'qa-admin')).statusCode, 201);
  await service.kick();
  const once = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: failedId } });
  assert.deepEqual([once.status, once.attempts, once.failureReason], ['FAILED', 6, 'HTTP_503'], 'one attempt per manual retry once the automatic ones are used');
  await prisma.notificationDelivery.update({ where: { id: failedId }, data: { attempts: 10 } });
  const capped = await request('POST', `/api/v1/settings/notification-deliveries/${failedId}/retry`, 'qa-admin');
  assert.deepEqual([capped.statusCode, json(capped).code], [409, 'NOTIFICATION_DELIVERY_RETRY_LIMIT']);
  assert.equal((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: failedId } })).status, 'FAILED');
});

test('Step 31: per-user Teams opt-in queues a copy without blocking the request, retries on failure and logs the reason', async (context) => {
  await cleanTeams();
  const service = app.get(NotificationDeliveryService);
  let status: number | 'network' = 503;
  const teams = mockTeams(() => status);
  const requests: string[] = [];
  context.after(async () => {
    teams.restore();
    await prisma.notification.deleteMany({ where: { roleRequestId: { in: requests } } });
    await prisma.roleRequest.deleteMany({ where: { id: { in: requests } } });
    await cleanTeams();
  });
  const prefs = '/api/v1/notifications/preferences';
  const unavailable = await request('PATCH', `${prefs}/ROLE_REQUEST`, 'qa-readonly', { teams: true });
  assert.equal(unavailable.statusCode, 409, 'cannot opt in while the ADMIN channel is off');
  assert.equal((await request('PATCH', `${prefs}/ROLE_REQUEST`, 'qa-readonly', {})).statusCode, 400);
  assert.deepEqual(json(await request('GET', '/api/v1/notifications/channels', 'qa-readonly')), { teams: { available: false }, email: { available: false } });

  await request('PUT', '/api/v1/settings/notification-channels/TEAMS/USER_NOTIFICATIONS', 'qa-admin', { enabled: true, webhookUrl: TEAMS_URL });
  const optIn = await request('PATCH', `${prefs}/ROLE_REQUEST`, 'qa-readonly', { teams: true });
  assert.equal(optIn.statusCode, 200, optIn.body);
  assert.deepEqual(json(optIn), { type: 'ROLE_REQUEST', muted: false, teams: true, teamsAvailable: true, email: false, emailAvailable: false, hasEmail: false });
  const listed = json(await request('GET', prefs, 'qa-readonly'));
  assert.deepEqual(listed.map((item: any) => [item.type, item.teams]), [['ROLE_REQUEST', true], ['CRITICAL_ASSET_ATTESTATION', false], ['LIFECYCLE_DATE', false]]);
  // Muting in-app and opting out of Teams are independent fields; a muted-only PATCH keeps the Teams choice.
  assert.equal(json(await request('PATCH', `${prefs}/LIFECYCLE_DATE`, 'qa-readonly', { muted: true })).teams, false);

  // Earlier tests may leave a request for these personas; one open request per user is allowed.
  const leftovers = (await prisma.roleRequest.findMany({ where: { userId: { in: [ids.readonly, ids.auditor] } }, select: { id: true } })).map((row) => row.id);
  await prisma.notification.deleteMany({ where: { roleRequestId: { in: leftovers } } });
  await prisma.roleRequest.deleteMany({ where: { id: { in: leftovers } } });
  const optedIn = await prisma.roleRequest.create({ data: { userId: ids.readonly, roles: ['SYSTEMS_OPERATOR'] } });
  const notOpted = await prisma.roleRequest.create({ data: { userId: ids.auditor, roles: ['SYSTEMS_OPERATOR'] } });
  requests.push(optedIn.id, notOpted.id);
  // The webhook would hang: the decision must still return, because sending happens off the request path.
  status = 503;
  const started = Date.now();
  for (const id of requests) assert.equal((await request('PATCH', `/api/v1/settings/role-requests/${id}`, 'qa-admin', { decision: 'REJECT' })).statusCode, 200);
  assert.ok(Date.now() - started < 5_000);
  assert.equal(teams.calls.length, 0, 'nothing is sent inside the request');
  const queued = await prisma.notificationDelivery.findMany({ where: { target: 'USER_NOTIFICATIONS' } });
  assert.deepEqual(queued.map((row) => [row.recipientUserId, row.topic, row.status]), [[ids.readonly, 'ROLE_REQUEST', 'PENDING']]);

  const output: string[] = [];
  const writes = [process.stdout.write, process.stderr.write];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => { output.push(String(chunk)); return (writes[0] as any).call(process.stdout, chunk, ...rest); }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => { output.push(String(chunk)); return (writes[1] as any).call(process.stderr, chunk, ...rest); }) as typeof process.stderr.write;
  // Nest may not print in test mode, so also capture what the application hands to its logger.
  const levels = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
  const originalLogger = levels.map((level) => Logger.prototype[level]);
  for (const level of levels) Logger.prototype[level] = function (this: Logger, ...args: unknown[]) { output.push(args.map(String).join(' ')); } as never;
  try {
    await service.kick();
    let row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: queued[0].id } });
    assert.deepEqual([row.status, row.attempts, row.failureReason], ['PENDING', 1, 'HTTP_503']);
    assert.ok(row.nextAttemptAt.getTime() > Date.now(), 'retry is scheduled for later');
    assert.equal(teams.calls[0].body.attachments[0].content.body[1].text, 'Para: qa-readonly');

    status = 'network';
    await prisma.notificationDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } });
    await service.kick();
    row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([row.status, row.attempts, row.failureReason], ['PENDING', 2, 'NETWORK_ERROR']);

    status = 200;
    await prisma.notificationDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } });
    await service.kick();
    row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([row.status, row.attempts, row.failureReason], ['SENT', 3, null]);
    assert.equal(teams.calls.length, 3);
  } finally {
    process.stdout.write = writes[0] as typeof process.stdout.write;
    process.stderr.write = writes[1] as typeof process.stderr.write;
    levels.forEach((level, index) => { Logger.prototype[level] = originalLogger[index] as never; });
  }
  assert.ok(output.join('').includes('HTTP_503'), 'the failure is logged');
  assertNoSecret('process logs', output.join(''));
  assertNoSecret('delivery log', (await request('GET', '/api/v1/settings/notification-deliveries', 'qa-admin')).body);

  // A permanent failure stops immediately; a disabled channel fails queued rows with a clear reason.
  await prisma.notificationDelivery.create({ data: { channel: 'TEAMS', target: 'USER_NOTIFICATIONS', topic: 'ROLE_REQUEST', recipientUserId: ids.readonly, title: 'x', message: 'y' } });
  status = 404;
  await service.kick();
  assert.equal(await prisma.notificationDelivery.count({ where: { status: 'FAILED', failureReason: 'HTTP_404', attempts: 1 } }), 1);
  await request('PUT', '/api/v1/settings/notification-channels/TEAMS/USER_NOTIFICATIONS', 'qa-admin', { enabled: false });
  await prisma.notificationDelivery.create({ data: { channel: 'TEAMS', target: 'USER_NOTIFICATIONS', topic: 'ROLE_REQUEST', recipientUserId: ids.readonly, title: 'x', message: 'y' } });
  await service.kick();
  assert.equal(await prisma.notificationDelivery.count({ where: { status: 'FAILED', failureReason: 'CHANNEL_DISABLED' } }), 1);
});

test('Step 31: a CRITICAL operational alert reaches the Teams group channel within 1 minute, once per opening', async (context) => {
  await cleanTeams();
  const teams = mockTeams(() => 200);
  const operations = app.get(OperationsService);
  const keys = ['step31:critical', 'step31:warning', 'step31:high-maintenance'];
  context.after(async () => {
    teams.restore();
    await prisma.operationalAlert.deleteMany({ where: { dedupKey: { in: keys } } });
    await prisma.maintenanceWindow.deleteMany({ where: { name: 'Step 31 window' } });
    await cleanTeams();
  });
  await request('PUT', '/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS', 'qa-admin', { enabled: true, webhookUrl: TEAMS_ALERTS_URL, minSeverity: 'HIGH' });
  const waitForCalls = async (count: number, budgetMs: number) => {
    const deadline = Date.now() + budgetMs;
    while (teams.calls.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  };

  const raisedAt = Date.now();
  await operations.upsert({ dedupKey: 'step31:critical', source: 'SNMP', severity: 'CRITICAL', siteId: ids.siteA, entityType: 'Device', entityId: ids.deviceA, title: 'Core switch down', detail: 'No response to SNMP', actionHref: null } as never);
  await waitForCalls(1, 60_000);
  assert.equal(teams.calls.length, 1, 'CRITICAL alert was not delivered within 1 minute');
  assert.ok(teams.calls[0].at - raisedAt < 60_000);
  assert.equal(teams.calls[0].url, TEAMS_ALERTS_URL);
  const card = teams.calls[0].body.attachments[0].content;
  assert.equal(card.body[0].text, '[CRITICAL] Core switch down');
  assert.equal(card.body[0].color, 'Attention');
  assert.match(card.body.at(-1).text, /HTTP Site A · No response to SNMP/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const sent = await prisma.notificationDelivery.findFirstOrThrow({ where: { topic: 'OPERATIONAL_ALERT' } });
  assert.equal(sent.status, 'SENT');

  // A repeat of the same open alert is not posted again.
  await operations.upsert({ dedupKey: 'step31:critical', source: 'SNMP', severity: 'CRITICAL', siteId: ids.siteA, entityType: 'Device', entityId: ids.deviceA, title: 'Core switch down', detail: 'Still down', actionHref: null } as never);
  // Below the threshold, and HIGH during a maintenance window, are not posted.
  await operations.upsert({ dedupKey: 'step31:warning', source: 'SNMP', severity: 'WARNING', siteId: ids.siteA, title: 'Minor', detail: 'x', actionHref: null } as never);
  await prisma.maintenanceWindow.create({ data: { name: 'Step 31 window', siteId: ids.siteA, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) } });
  await operations.upsert({ dedupKey: 'step31:high-maintenance', source: 'SNMP', severity: 'HIGH', siteId: ids.siteA, title: 'Planned', detail: 'x', actionHref: null } as never);
  await app.get(NotificationDeliveryService).kick();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(teams.calls.length, 1);
  assert.equal(await prisma.notificationDelivery.count({ where: { topic: 'OPERATIONAL_ALERT' } }), 1);

  // Resolved and reopened is a new opening and is posted again.
  await prisma.operationalAlert.update({ where: { dedupKey: 'step31:critical' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  await operations.upsert({ dedupKey: 'step31:critical', source: 'SNMP', severity: 'CRITICAL', siteId: ids.siteA, entityType: 'Device', entityId: ids.deviceA, title: 'Core switch down', detail: 'Down again', actionHref: null } as never);
  await waitForCalls(2, 60_000);
  assert.equal(teams.calls.length, 2);
});

// ----- Step 31: Email (SMTP) delivery -----
const SMTP_PASSWORD = 'step31-smtp-P4ss!';
const SMTP_BODY = { host: 'smtp.example.pt', port: 587, security: 'STARTTLS', username: 'mgmt-alerts@example.pt', password: SMTP_PASSWORD, from: 'mgmt-alerts@example.pt' };
type SmtpCall = { options: any; mail: any; at: number };
/** Swaps the SMTP transport for a mock; nodemailer still builds the transport options and message fields. */
function mockSmtp(outcome: (call: SmtpCall) => 'ok' | Record<string, unknown>) {
  const calls: SmtpCall[] = [];
  const senders = (app.get(NotificationDeliveryService) as any).senders as Map<string, unknown>;
  const original = senders.get('EMAIL');
  // The resolver stands in for DNS: smtp.example.pt resolves to a private (RFC 1918) relay address, which is allowed.
  senders.set('EMAIL', new EmailSender((options) => ({
    sendMail: async (mail) => {
      const call = { options, mail, at: Date.now() };
      calls.push(call);
      const result = outcome(call);
      if (result !== 'ok') throw Object.assign(new Error(`SMTP said no to ${String((mail as any).to)} using ${SMTP_PASSWORD}`), result);
      return { messageId: 'x' };
    },
  }), async () => ['10.20.30.40']));
  return { calls, restore: () => { senders.set('EMAIL', original); } };
}
const assertNoSmtpSecret = (label: string, text: string) => assert.ok(!text.includes(SMTP_PASSWORD), `${label} leaked the SMTP password`);

test('Step 31 email: ADMIN SMTP settings start off, keep the password encrypted and write-only, and group alerts need recipients', async (context) => {
  context.after(cleanTeams);
  await cleanTeams();
  const root = '/api/v1/settings/notification-channels';
  assert.equal((await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-network-scoped', { enabled: false, smtp: SMTP_BODY })).statusCode, 403);
  assert.equal((await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true })).statusCode, 409, 'cannot enable before the server is saved');
  const plain = await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, smtp: { ...SMTP_BODY, security: 'NONE' } });
  assert.equal(plain.statusCode, 400);
  assert.equal(json(plain).code, 'SMTP_AUTH_NEEDS_TLS');
  assertNoSmtpSecret('validation error', plain.body);
  assert.equal(json(await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, smtp: { ...SMTP_BODY, from: 'x@y.pt\r\nBcc: z@evil.com' } })).code, 'SMTP_FROM_INVALID');
  assert.equal((await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, webhookUrl: TEAMS_URL })).statusCode, 400, 'Teams fields do not apply to e-mail');
  assert.equal((await request('PUT', `${root}/EMAIL/GROUP_ALERTS`, 'qa-admin', { enabled: true, recipients: ['noc@example.pt'] })).statusCode, 409, 'group alerts need the SMTP server first');

  // Loopback, link-local (cloud metadata) and unspecified hosts are refused; private on-prem relays are allowed.
  for (const host of ['127.0.0.1', '169.254.169.254', '::1', '0.0.0.0', '::ffff:127.0.0.1', 'localhost']) {
    const refused = await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, smtp: { ...SMTP_BODY, host } });
    assert.deepEqual([refused.statusCode, json(refused).code], [400, 'SMTP_HOST_NOT_ALLOWED'], host);
  }
  const relay = await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: false, smtp: { ...SMTP_BODY, host: '10.0.0.25' } });
  assert.equal(relay.statusCode, 200, relay.body);

  const saved = await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: SMTP_BODY });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual([json(saved).enabled, json(saved).configured], [true, true]);
  assert.deepEqual(json(saved).smtp, { host: 'smtp.example.pt', port: 587, security: 'STARTTLS', username: 'mgmt-alerts@example.pt', from: 'mgmt-alerts@example.pt', passwordSet: true });
  assertNoSmtpSecret('save response', saved.body);
  // Re-saving the same server and account without a password keeps the stored one (here only the sender changes).
  const { password: _omit, ...withoutPassword } = SMTP_BODY;
  const kept = json(await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: { ...withoutPassword, from: 'noc-mail@example.pt' } }));
  assert.deepEqual([kept.smtp.from, kept.smtp.passwordSet], ['noc-mail@example.pt', true]);
  // Changing host, port, security or username never carries the password over: it must be entered again.
  for (const change of [{ host: 'smtp2.example.pt' }, { port: 465, security: 'TLS' }, { port: 2525 }, { username: 'other@example.pt' }]) {
    const refused = await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: { ...withoutPassword, ...change } });
    assert.deepEqual([refused.statusCode, json(refused).code], [400, 'SMTP_PASSWORD_REENTRY_REQUIRED'], JSON.stringify(change));
  }
  const unchanged = json(await request('GET', root, 'qa-admin')).channels.find((item: any) => item.kind === 'EMAIL' && item.target === 'USER_NOTIFICATIONS');
  assert.deepEqual([unchanged.smtp.port, unchanged.smtp.security, unchanged.smtp.passwordSet], [587, 'STARTTLS', true], 'a refused change keeps the old server and its password');
  const moved = json(await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: { ...SMTP_BODY, port: 465, security: 'TLS' } }));
  assert.deepEqual([moved.smtp.port, moved.smtp.security, moved.smtp.passwordSet], [465, 'TLS', true]);
  // Dropping the username clears the password.
  const anonymous = json(await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: { ...withoutPassword, port: 465, security: 'TLS', username: null } }));
  assert.deepEqual([anonymous.smtp.username, anonymous.smtp.passwordSet], [null, false]);
  assert.equal((await prisma.deliveryChannelConfig.findUniqueOrThrow({ where: { kind_target: { kind: 'EMAIL', target: 'USER_NOTIFICATIONS' } } })).ciphertext, null);
  assert.equal(json(await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: SMTP_BODY })).smtp.passwordSet, true);
  // A row saved before hosts were normalised may hold mixed case: the same server in lowercase is not a connection change.
  const beforeCase = await prisma.deliveryChannelConfig.findUniqueOrThrow({ where: { kind_target: { kind: 'EMAIL', target: 'USER_NOTIFICATIONS' } } });
  await prisma.deliveryChannelConfig.update({ where: { kind_target: { kind: 'EMAIL', target: 'USER_NOTIFICATIONS' } }, data: { settings: { ...(beforeCase.settings as object), host: 'SMTP.Example.pt' } } });
  const caseOnly = await request('PUT', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin', { enabled: true, smtp: withoutPassword });
  assert.equal(caseOnly.statusCode, 200, caseOnly.body);
  assert.deepEqual([json(caseOnly).smtp.host, json(caseOnly).smtp.passwordSet], ['smtp.example.pt', true], 'a case-only host change keeps the stored password');

  assert.equal(json(await request('PUT', `${root}/EMAIL/GROUP_ALERTS`, 'qa-admin', { enabled: true, recipients: ['bad'] })).code, 'EMAIL_RECIPIENTS_INVALID');
  const group = await request('PUT', `${root}/EMAIL/GROUP_ALERTS`, 'qa-admin', { enabled: true, minSeverity: 'CRITICAL', recipients: [' NOC@example.pt ', 'oncall@example.pt'] });
  assert.equal(group.statusCode, 200, group.body);
  assert.deepEqual([json(group).configured, json(group).minSeverity, json(group).recipients, json(group).serverConfigured], [true, 'CRITICAL', ['noc@example.pt', 'oncall@example.pt'], true]);

  const listed = await request('GET', root, 'qa-admin');
  assertNoSmtpSecret('channel list', listed.body);
  assert.deepEqual(json(listed).channels.filter((item: any) => item.kind === 'EMAIL').map((item: any) => [item.target, item.enabled]), [['USER_NOTIFICATIONS', true], ['GROUP_ALERTS', true]]);
  const stored = await prisma.deliveryChannelConfig.findMany({ where: { kind: 'EMAIL' } });
  for (const row of stored) assertNoSmtpSecret('stored row', Buffer.from(row.ciphertext ?? []).toString('latin1') + JSON.stringify({ ...row, ciphertext: undefined }));
  assertNoSmtpSecret('audit log', JSON.stringify(await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })));

  // Removing the server leaves group alerts unconfigured.
  await request('DELETE', `${root}/EMAIL/USER_NOTIFICATIONS`, 'qa-admin');
  const after = json(await request('GET', root, 'qa-admin')).channels.filter((item: any) => item.kind === 'EMAIL');
  assert.deepEqual(after.map((item: any) => [item.target, item.configured]), [['USER_NOTIFICATIONS', false], ['GROUP_ALERTS', false]]);
});

test('Step 31 email: test email to the ADMIN, per-user opt-in to the own address, retries with backoff and a secret-free log', async (context) => {
  await cleanTeams();
  const service = app.get(NotificationDeliveryService);
  let result: 'ok' | Record<string, unknown> = 'ok';
  const smtp = mockSmtp(() => result);
  const requests: string[] = [];
  context.after(async () => {
    smtp.restore();
    await prisma.notification.deleteMany({ where: { roleRequestId: { in: requests } } });
    await prisma.roleRequest.deleteMany({ where: { id: { in: requests } } });
    await cleanTeams();
  });
  const root = '/api/v1/settings/notification-channels/EMAIL/USER_NOTIFICATIONS';
  assert.equal((await request('POST', `${root}/test`, 'qa-admin')).statusCode, 409, 'cannot test before the server is saved');
  await request('PUT', root, 'qa-admin', { enabled: false, smtp: SMTP_BODY });
  const noAddress = await request('POST', `${root}/test`, 'qa-admin');
  assert.equal(json(noAddress).code, 'NOTIFICATION_TEST_NO_EMAIL');

  await prisma.user.update({ where: { id: ids.admin }, data: { email: 'admin@example.pt' } });
  const ok = await request('POST', `${root}/test`, 'qa-admin');
  assert.equal(ok.statusCode, 201, ok.body);
  assert.deepEqual([json(ok).status, json(ok).failureReason], ['SENT', null]);
  assert.deepEqual([smtp.calls[0].mail.to, smtp.calls[0].mail.from, smtp.calls[0].mail.subject], [['admin@example.pt'], 'mgmt-alerts@example.pt', 'Email de teste']);
  assert.equal(smtp.calls[0].mail.bcc, undefined, 'personal e-mail has no Bcc');
  // Connects to the checked address; TLS still presents and verifies the configured host name.
  assert.deepEqual([smtp.calls[0].options.host, smtp.calls[0].options.servername, smtp.calls[0].options.tls.servername, smtp.calls[0].options.requireTLS, smtp.calls[0].options.auth.pass], ['10.20.30.40', 'smtp.example.pt', 'smtp.example.pt', true, SMTP_PASSWORD]);

  result = { code: 'EAUTH', responseCode: 535 };
  const failed = await request('POST', `${root}/test`, 'qa-admin');
  assert.deepEqual([json(failed).status, json(failed).failureReason], ['FAILED', 'SMTP_EAUTH_535']);
  assertNoSmtpSecret('test failure response', failed.body);

  // Per-user opt-in: unavailable while the channel is off, and only with an address on file.
  const prefs = '/api/v1/notifications/preferences';
  assert.equal((await request('PATCH', `${prefs}/ROLE_REQUEST`, 'qa-readonly', { email: true })).statusCode, 409);
  await request('PUT', root, 'qa-admin', { enabled: true });
  assert.deepEqual(json(await request('GET', '/api/v1/notifications/channels', 'qa-readonly')).email, { available: true });
  assert.equal(json(await request('PATCH', `${prefs}/ROLE_REQUEST`, 'qa-readonly', { email: true })).code, 'NOTIFICATION_EMAIL_MISSING');
  await prisma.user.update({ where: { id: ids.readonly }, data: { email: 'readonly@example.pt' } });
  const optIn = json(await request('PATCH', `${prefs}/ROLE_REQUEST`, 'qa-readonly', { email: true }));
  assert.deepEqual([optIn.email, optIn.emailAvailable, optIn.hasEmail, optIn.teams], [true, true, true, false]);
  assert.deepEqual(json(await request('GET', prefs, 'qa-readonly')).map((item: any) => [item.type, item.email]), [['ROLE_REQUEST', true], ['CRITICAL_ASSET_ATTESTATION', false], ['LIFECYCLE_DATE', false]]);

  const leftovers = (await prisma.roleRequest.findMany({ where: { userId: { in: [ids.readonly, ids.auditor] } }, select: { id: true } })).map((row) => row.id);
  await prisma.notification.deleteMany({ where: { roleRequestId: { in: leftovers } } });
  await prisma.roleRequest.deleteMany({ where: { id: { in: leftovers } } });
  const optedIn = await prisma.roleRequest.create({ data: { userId: ids.readonly, roles: ['SYSTEMS_OPERATOR'] } });
  const notOpted = await prisma.roleRequest.create({ data: { userId: ids.auditor, roles: ['SYSTEMS_OPERATOR'] } });
  requests.push(optedIn.id, notOpted.id);
  result = { code: 'ECONNECTION' };
  const before = smtp.calls.length;
  const started = Date.now();
  for (const id of requests) assert.equal((await request('PATCH', `/api/v1/settings/role-requests/${id}`, 'qa-admin', { decision: 'REJECT' })).statusCode, 200);
  assert.ok(Date.now() - started < 5_000);
  assert.equal(smtp.calls.length, before, 'nothing is sent inside the request');
  const queued = await prisma.notificationDelivery.findMany({ where: { target: 'USER_NOTIFICATIONS', topic: 'ROLE_REQUEST' } });
  assert.deepEqual(queued.map((row) => [row.channel, row.recipientUserId, row.status]), [['EMAIL', ids.readonly, 'PENDING']]);

  const output: string[] = [];
  const levels = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
  const originalLogger = levels.map((level) => Logger.prototype[level]);
  for (const level of levels) Logger.prototype[level] = function (this: Logger, ...args: unknown[]) { output.push(args.map(String).join(' ')); } as never;
  try {
    await service.kick();
    let row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: queued[0].id } });
    assert.deepEqual([row.status, row.attempts, row.failureReason], ['PENDING', 1, 'SMTP_CONNECTION_FAILED']);
    assert.ok(row.nextAttemptAt.getTime() - Date.now() > 20_000, 'first retry waits about 30 s');
    assert.deepEqual(smtp.calls.at(-1)!.mail.to, ['readonly@example.pt'], 'personal e-mail goes to the user\'s own address');

    result = 'ok';
    await prisma.notificationDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } });
    await service.kick();
    row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual([row.status, row.attempts, row.failureReason], ['SENT', 2, null]);

    // A recipient without an address fails at once with a clear reason; a 5xx rejection is permanent.
    await prisma.notificationDelivery.create({ data: { channel: 'EMAIL', target: 'USER_NOTIFICATIONS', topic: 'ROLE_REQUEST', recipientUserId: ids.auditor, title: 'x', message: 'y' } });
    result = { code: 'EENVELOPE', responseCode: 550, permanent: true };
    await prisma.notificationDelivery.create({ data: { channel: 'EMAIL', target: 'USER_NOTIFICATIONS', topic: 'ROLE_REQUEST', recipientUserId: ids.readonly, title: 'x', message: 'y' } });
    await service.kick();
    assert.equal(await prisma.notificationDelivery.count({ where: { status: 'FAILED', failureReason: 'RECIPIENT_NO_EMAIL', attempts: 1 } }), 1);
    assert.equal(await prisma.notificationDelivery.count({ where: { status: 'FAILED', failureReason: 'SMTP_550', attempts: 1 } }), 1);
  } finally {
    levels.forEach((level, index) => { Logger.prototype[level] = originalLogger[index] as never; });
  }
  assert.ok(output.join(' ').includes('SMTP_CONNECTION_FAILED'), 'the failure is logged');
  assertNoSmtpSecret('process logs', output.join(' '));
  const log = await request('GET', '/api/v1/settings/notification-deliveries?channel=EMAIL', 'qa-admin');
  assert.ok(json(log).items.every((item: any) => item.channel === 'EMAIL'));
  assertNoSmtpSecret('delivery log', log.body);
  assertNoSmtpSecret('audit log', JSON.stringify(await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })));
});

test('Step 31 email: a CRITICAL operational alert is e-mailed to the group recipients within 1 minute, once per opening', async (context) => {
  await cleanTeams();
  const smtp = mockSmtp(() => 'ok');
  const teams = mockTeams(() => 200);
  const operations = app.get(OperationsService);
  context.after(async () => {
    smtp.restore();
    teams.restore();
    await prisma.operationalAlert.deleteMany({ where: { dedupKey: { startsWith: 'step31-email:' } } });
    await cleanTeams();
  });
  await request('PUT', '/api/v1/settings/notification-channels/EMAIL/USER_NOTIFICATIONS', 'qa-admin', { enabled: false, smtp: SMTP_BODY });
  await request('PUT', '/api/v1/settings/notification-channels/EMAIL/GROUP_ALERTS', 'qa-admin', { enabled: true, minSeverity: 'CRITICAL', recipients: ['noc@example.pt', 'oncall@example.pt'] });
  await request('PUT', '/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS', 'qa-admin', { enabled: true, webhookUrl: TEAMS_ALERTS_URL, minSeverity: 'HIGH' });
  const waitFor = async (check: () => boolean, budgetMs: number) => {
    const deadline = Date.now() + budgetMs;
    while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  };

  const raisedAt = Date.now();
  await operations.upsert({ dedupKey: 'step31-email:critical', source: 'SNMP', severity: 'CRITICAL', siteId: ids.siteA, entityType: 'Device', entityId: ids.deviceA, title: 'Core router down', detail: 'No response to SNMP', actionHref: null } as never);
  await waitFor(() => smtp.calls.length >= 1 && teams.calls.length >= 1, 60_000);
  assert.equal(smtp.calls.length, 1, 'CRITICAL alert e-mail was not sent within 1 minute');
  assert.ok(smtp.calls[0].at - raisedAt < 60_000);
  // Recipients go in Bcc (To is the sender address), so they never see each other.
  assert.deepEqual([smtp.calls[0].mail.to, smtp.calls[0].mail.bcc], ['mgmt-alerts@example.pt', ['noc@example.pt', 'oncall@example.pt']]);
  assert.equal(smtp.calls[0].mail.subject, '[CRITICAL] Core router down');
  assert.match(smtp.calls[0].mail.text, /HTTP Site A · No response to SNMP/);
  assert.equal(teams.calls.length, 1, 'the Teams group channel gets its own copy');

  // HIGH is below this e-mail threshold (CRITICAL only) but still goes to Teams (HIGH and above); repeats are not sent again.
  // Site B: an earlier test leaves a maintenance window open on Site A, which would hold back HIGH.
  await operations.upsert({ dedupKey: 'step31-email:high', source: 'SNMP', severity: 'HIGH', siteId: ids.siteB, title: 'Uplink degraded', detail: 'x', actionHref: null } as never);
  await operations.upsert({ dedupKey: 'step31-email:critical', source: 'SNMP', severity: 'CRITICAL', siteId: ids.siteA, entityType: 'Device', entityId: ids.deviceA, title: 'Core router down', detail: 'Still down', actionHref: null } as never);
  await app.get(NotificationDeliveryService).kick();
  await waitFor(() => teams.calls.length >= 2, 5_000);
  assert.equal(smtp.calls.length, 1);
  assert.equal(teams.calls.length, 2);
  const rows = await prisma.notificationDelivery.findMany({ where: { topic: 'OPERATIONAL_ALERT' }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((row) => [row.channel, row.title, row.status]).sort(), [
    ['EMAIL', '[CRITICAL] Core router down', 'SENT'], ['TEAMS', '[CRITICAL] Core router down', 'SENT'], ['TEAMS', '[HIGH] Uplink degraded', 'SENT'],
  ]);
});

test('Step 34 topology impact: core switch, loops, depth bound, PDU feeds, path view and the 2 s budget on a large site', async () => {
  const uid = (n: number) => `34000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const site = uid(1), building = uid(2), room = uid(3), rack = uid(4), pduA = uid(5), pduB = uid(6);
  await prisma.site.create({ data: { id: site, name: 'HTTP Impact Site', code: 'HTTP-IMPACT' } });
  await prisma.building.create({ data: { id: building, name: 'Impact Building', siteId: site } });
  await prisma.room.create({ data: { id: room, name: 'Impact Room', buildingId: building } });
  await prisma.rack.create({ data: { id: rack, name: 'Impact Rack', roomId: room } });
  const named = ['fw', 'core1', 'core2', 'dist1', 'dist2', 'acc1', 'acc2', 'acc3', 'srv1', 'srv2', 'srv3'];
  const dev = new Map(named.map((name, index) => [name, uid(100 + index)]));
  for (let ring = 0; ring < 30; ring += 1) dev.set(`ring${ring}`, uid(200 + ring));
  for (let server = 0; server < 3000; server += 1) dev.set(`bulk${server}`, uid(1000 + server));
  const typeOf = (name: string) => name === 'fw' ? 'FIREWALL' : /^(srv|bulk)/.test(name) ? 'SERVER' : 'SWITCH';
  await prisma.device.createMany({ data: [...dev.entries()].map(([name, id]) => ({ id, name: `IMPACT ${name}`, type: typeOf(name), siteId: site, rackId: named.includes(name) ? rack : null, hostname: name === 'srv1' ? 'impact-srv1.corp.local' : null, criticalityTier: name === 'srv1' ? 'T1' as const : null })) });
  const pairs: [string, string][] = [
    ['fw', 'core1'], ['core1', 'dist1'], ['dist1', 'acc1'], ['acc1', 'srv1'], ['dist1', 'acc2'], ['acc2', 'srv2'], ['acc1', 'acc2'],
    ['core1', 'dist2'], ['dist2', 'acc3'], ['acc3', 'srv3'], ['core2', 'dist2'], ['core2', 'fw'],
  ];
  for (let ring = 0; ring < 30; ring += 1) pairs.push([ring === 0 ? 'acc3' : `ring${ring - 1}`, `ring${ring}`]);
  pairs.push(['ring29', 'acc3']);
  for (let server = 0; server < 3000; server += 1) pairs.push([`ring${server % 30}`, `bulk${server}`]);
  await prisma.deviceConnection.createMany({ data: pairs.map(([a, b], index) => ({ id: uid(10_000 + index), siteId: site, type: 'PHYSICAL' as const, sourceDeviceId: index % 2 ? dev.get(b)! : dev.get(a)!, targetDeviceId: index % 2 ? dev.get(a)! : dev.get(b)! })) });
  await prisma.rackPdu.createMany({ data: [{ id: pduA, rackId: rack, source: 'SUPPLIER' }, { id: pduB, rackId: rack, source: 'UPS' }] });
  await prisma.pduOutletAssignment.createMany({ data: [
    { pduId: pduA, outletIndex: 1, deviceId: dev.get('srv1')!, plugIndex: 1 }, { pduId: pduB, outletIndex: 1, deviceId: dev.get('srv1')!, plugIndex: 2 },
    { pduId: pduA, outletIndex: 2, deviceId: dev.get('srv2')!, plugIndex: 1 },
  ] });
  await prisma.host.create({ data: { name: 'impact-srv1', hostname: 'impact-srv1.corp.local', deviceId: dev.get('srv1')!, services: { create: [{ name: 'https', protocol: 'tcp', port: 443 }] } } });
  await prisma.applicationLink.create({ data: { name: 'Impact ERP', url: 'https://impact-srv1.corp.local/erp' } });

  const timed = async (path: string) => { const started = performance.now(); const response = await request('GET', path, 'qa-admin'); const elapsed = performance.now() - started; assert.equal(response.statusCode, 200, response.body); return { body: json(response), elapsed }; };
  const core = await timed(`/api/v1/topology/impact?deviceId=${dev.get('core1')}`);
  assert.deepEqual(core.body.affected.map((item: { name: string }) => item.name).sort(), ['IMPACT acc1', 'IMPACT acc2', 'IMPACT dist1', 'IMPACT srv1', 'IMPACT srv2']);
  assert.equal(core.body.anchorMode, 'gateway-devices');
  assert.deepEqual(core.body.critical.T1, [dev.get('srv1')]);
  assert.deepEqual(core.body.hosts.map((item: { name: string }) => item.name), ['impact-srv1']);
  assert.deepEqual(core.body.applications.map((item: { name: string }) => item.name), ['Impact ERP']);
  assert.ok(core.elapsed < 2000, `core impact took ${core.elapsed} ms`);

  const wide = await timed(`/api/v1/topology/impact?deviceId=${dev.get('dist2')}&maxDepth=32`);
  assert.equal(wide.body.affected.length, 3032, 'acc3, srv3, the 30-switch ring and its 3,000 servers');
  assert.equal(wide.body.truncated, false);
  assert.ok(wide.elapsed < 2000, `wide impact took ${wide.elapsed} ms`);
  const bounded = await timed(`/api/v1/topology/impact?deviceId=${dev.get('dist2')}&maxDepth=3`);
  assert.equal(bounded.body.truncated, true);
  assert.ok(bounded.body.affected.every((item: { hops: number }) => item.hops <= 3));

  const power = await timed(`/api/v1/topology/impact?pduId=${pduA}`);
  assert.deepEqual(power.body.down.map((item: { name: string; reason: string }) => [item.name, item.reason]), [['IMPACT srv2', 'POWER']]);
  assert.deepEqual(power.body.powerDegraded.map((item: { name: string }) => item.name), ['IMPACT srv1']);

  const path = await timed(`/api/v1/topology/path?fromDeviceId=${dev.get('srv1')}&toDeviceId=${dev.get('bulk2999')}`);
  assert.equal(path.body.found, true);
  assert.deepEqual(path.body.steps.slice(0, 6).map((item: { name: string }) => item.name), ['IMPACT srv1', 'IMPACT acc1', 'IMPACT dist1', 'IMPACT core1', 'IMPACT dist2', 'IMPACT acc3']);
  assert.ok(path.elapsed < 2000, `path took ${path.elapsed} ms`);

  for (const bad of ['', `deviceId=${dev.get('fw')}&rackId=${rack}`, 'deviceId=not-a-uuid']) assert.equal((await request('GET', `/api/v1/topology/impact?${bad}`, 'qa-admin')).statusCode, 400, bad);
  assert.equal((await request('GET', `/api/v1/topology/impact?deviceId=${dev.get('core1')}`, 'qa-systems-scoped')).statusCode, 404, 'out-of-scope devices are not revealed');
  console.log(`[step34] core ${core.elapsed.toFixed(0)} ms (server ${core.body.elapsedMs} ms), wide ${wide.elapsed.toFixed(0)} ms (server ${wide.body.elapsedMs} ms), path ${path.elapsed.toFixed(0)} ms`);
});

// ----- Step 32: scheduled reports -----

type ReportSite = { siteId: string; siteName: string; compliance?: any; lifecycle?: any; quality?: any; capacity?: any; changes?: any };
const dayIso = (date: Date) => date.toISOString().slice(0, 10);
const addUtcDays = (iso: string, days: number) => dayIso(new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000));

/** Recomputes every report figure for one Site from the source endpoints, as `persona`, for the report's date range. */
async function sourceFigures(persona: string, siteId: string, report: { periodStart: string; periodEnd: string }, lifecycle: { from: string; to: string }) {
  const get = async (url: string) => { const response = await request('GET', url, persona); assert.equal(response.statusCode, 200, `${url}: ${response.body}`); return json(response); };
  const end = addUtcDays(report.periodEnd, 1); // UTC report: the period ends at midnight after its last day
  const critical = await get(`/api/v1/critical-assets?siteId=${siteId}`);
  const assets = new Map<string, any>();
  for (const asset of [...critical.assets, ...critical.unassigned]) if (!assets.has(asset.id)) assets.set(asset.id, asset);
  let expected = 0; let onTime = 0;
  for (const asset of assets.values()) {
    if (!asset.owner?.name) continue;
    for (const item of asset.attestations) {
      const week = String(item.weekStart).slice(0, 10);
      if (week < report.periodStart || week >= end) continue;
      expected += 1;
      if (item.outcome && item.confirmedAt && Date.parse(item.confirmedAt) < Date.parse(item.dueAt)) onTime += 1;
    }
  }
  const dates = await get(`/api/v1/lifecycle-dates?siteId=${siteId}&from=${lifecycle.from}&to=${lifecycle.to}`);
  const quality = await get(`/api/v1/inventory-quality/summary?siteId=${siteId}`);
  const bySeverity: Record<string, number> = {};
  for (const group of quality.groups) bySeverity[group.severity] = (bySeverity[group.severity] ?? 0) + group._count._all;
  const outlook = await get(`/api/v1/sites/${siteId}/capacity-outlook`);
  const plansBody = await get(`/api/v1/change-plans?siteId=${siteId}&status=COMPLETED,FAILED,ROLLED_BACK&from=${report.periodStart}T00:00:00.000Z&to=${end}T00:00:00.000Z`);
  const plans: any[] = Array.isArray(plansBody) ? plansBody : plansBody.items;
  return {
    compliance: { expected, onTime },
    lifecycle: dates.items.map((item: any) => [item.device.name, item.kind, item.dueDate]),
    quality: { total: quality.findingCount, bySeverity },
    capacity: {
      warning: outlook.items.filter((item: any) => item.level === 'warning').length,
      critical: outlook.items.filter((item: any) => item.level === 'critical').length,
    },
    changes: { completed: plans.filter((plan) => plan.status === 'COMPLETED').length, failed: plans.filter((plan) => plan.status === 'FAILED').length, rolledBack: plans.filter((plan) => plan.status === 'ROLLED_BACK').length, titles: plans.map((plan) => plan.title).sort() },
  };
}

function reportFigures(site: ReportSite) {
  return {
    compliance: { expected: site.compliance.expected, onTime: site.compliance.onTime },
    lifecycle: site.lifecycle.items.map((item: any) => [item.deviceName, item.kind, item.dueDate]),
    quality: { total: site.quality.total, bySeverity: site.quality.bySeverity },
    capacity: { warning: site.capacity.warning, critical: site.capacity.critical },
    changes: { completed: site.changes.completed, failed: site.changes.failed, rolledBack: site.changes.rolledBack, titles: site.changes.items.map((item: any) => item.title).sort() },
  };
}

test('Step 32 scheduled reports: figures equal the source endpoints, per-recipient Sites, e-mail with CSV, Teams summary, unsubscribe link and toggle', async (context) => {
  await cleanTeams();
  const smtp = mockSmtp(() => 'ok');
  const teams = mockTeams(() => 200);
  const delivery = app.get(NotificationDeliveryService);
  const reports = app.get(ScheduledReportsService);
  const originalPublicUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'https://mgmt.example.pt';
  const created: { plans: string[]; dates: string[]; attestations: string[] } = { plans: [], dates: [], attestations: [] };
  context.after(async () => {
    smtp.restore(); teams.restore();
    if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = originalPublicUrl;
    await prisma.scheduledReport.deleteMany({});
    await prisma.changePlan.deleteMany({ where: { id: { in: created.plans } } });
    await prisma.lifecycleDate.deleteMany({ where: { id: { in: created.dates } } });
    await prisma.criticalAssetAttestation.deleteMany({ where: { id: { in: created.attestations } } });
    await cleanTeams();
  });

  // Channels and addresses.
  assert.equal((await request('PUT', '/api/v1/settings/notification-channels/EMAIL/USER_NOTIFICATIONS', 'qa-admin', { enabled: true, smtp: SMTP_BODY })).statusCode, 200);
  assert.equal((await request('PUT', '/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS', 'qa-admin', { enabled: true, webhookUrl: TEAMS_ALERTS_URL })).statusCode, 200);
  await prisma.user.update({ where: { id: ids.admin }, data: { email: 'admin@example.pt' } });
  await prisma.user.update({ where: { id: ids.scoped }, data: { email: 'scoped@example.pt' } });

  // Source data in both Sites, inside the weekly period (UTC: the 7 days before today) and the next 90 days.
  const today = dayIso(new Date());
  const periodStart = addUtcDays(today, -7);
  const monday = [0, 1, 2, 3, 4, 5, 6].map((offset) => addUtcDays(periodStart, offset)).find((iso) => new Date(`${iso}T00:00:00.000Z`).getUTCDay() === 1)!;
  const at = (iso: string, hour: number) => new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  await prisma.device.updateMany({ where: { id: { in: [ids.deviceA, ids.deviceB] } }, data: { isCritical: true } });
  await prisma.criticalAssetGroupMapping.upsert({ where: { siteId_assetType: { siteId: ids.siteA, assetType: 'SWITCH' } }, create: { siteId: ids.siteA, assetType: 'SWITCH', groupId: ids.groupRead }, update: {} });
  await prisma.criticalAssetGroupMapping.upsert({ where: { siteId_assetType: { siteId: ids.siteB, assetType: 'SWITCH' } }, create: { siteId: ids.siteB, assetType: 'SWITCH', groupId: ids.groupWrite }, update: {} });
  for (const [deviceId, siteId] of [[ids.deviceA, ids.siteA], [ids.deviceB, ids.siteB]]) {
    const row = await prisma.criticalAssetAttestation.upsert({
      where: { deviceId_weekStart: { deviceId, weekStart: at(monday, 0) } },
      create: { deviceId, siteId, weekStart: at(monday, 0), outcome: 'CONFIRMED', confirmedAt: at(monday, 12), confirmedBy: ids.admin },
      update: { outcome: 'CONFIRMED', confirmedAt: at(monday, 12), confirmedBy: ids.admin },
    });
    created.attestations.push(row.id);
  }
  for (const [deviceId, kind, days] of [[ids.deviceA, 'WARRANTY', 30], [ids.deviceB, 'LICENSE', 20]] as const) {
    await prisma.lifecycleDate.deleteMany({ where: { deviceId, kind } });
    created.dates.push((await prisma.lifecycleDate.create({ data: { deviceId, kind, dueDate: at(addUtcDays(today, days), 0) } })).id);
  }
  const plan = async (siteId: string, title: string, status: 'COMPLETED' | 'FAILED' | 'ROLLED_BACK' | 'APPROVED', iso: string) =>
    created.plans.push((await prisma.changePlan.create({ data: { siteId, title, reason: 'Step 32', plannedStartAt: at(iso, 21), plannedEndAt: at(iso, 23), status, createdById: ids.admin } })).id);
  await plan(ids.siteA, 'Step 32 done A', 'COMPLETED', addUtcDays(today, -3));
  await plan(ids.siteA, 'Step 32 failed A', 'FAILED', addUtcDays(today, -2));
  await plan(ids.siteA, 'Step 32 approved A (not reported)', 'APPROVED', addUtcDays(today, -2));
  await plan(ids.siteA, 'Step 32 done long ago (outside)', 'COMPLETED', addUtcDays(today, -20));
  await plan(ids.siteB, 'Step 32 rolled back B', 'ROLLED_BACK', addUtcDays(today, -1));

  // Definitions are ADMIN only.
  const root = '/api/v1/settings/scheduled-reports';
  const definition = { name: 'Operação semanal', frequency: 'WEEKLY', dayOfWeek: 1, hour: 8, timezone: 'UTC', sections: ['COMPLIANCE', 'LIFECYCLE', 'QUALITY', 'CAPACITY', 'CHANGES'], recipientIds: [ids.admin, ids.scoped], sendEmail: true, sendTeams: true };
  assert.equal((await request('GET', root)).statusCode, 401);
  assert.equal((await request('GET', root, 'qa-network-scoped')).statusCode, 403);
  assert.equal((await request('POST', root, 'qa-auditor', definition)).statusCode, 403);
  assert.equal((await request('POST', root, 'qa-admin', { ...definition, sections: [] })).statusCode, 400);
  assert.equal((await request('POST', root, 'qa-admin', { ...definition, timezone: 'Mars/Base' })).statusCode, 400);
  assert.equal((await request('POST', root, 'qa-admin', { ...definition, sendEmail: false, sendTeams: false })).statusCode, 400);
  const createdReport = await request('POST', root, 'qa-admin', definition);
  assert.equal(createdReport.statusCode, 201, createdReport.body);
  const report = json(createdReport);
  assert.equal(new Date(report.nextRunAt).getUTCDay(), 1);
  assert.equal(new Date(report.nextRunAt).getUTCHours(), 8);
  assert.deepEqual(report.recipients.map((item: any) => item.userId).sort(), [ids.admin, ids.scoped].sort());
  const listed = json(await request('GET', root, 'qa-admin'));
  assert.deepEqual(listed.channels, { email: true, teams: true });
  assert.equal(listed.reports.length, 1);

  // Report figures equal the source endpoints for the same range, for each person and Site they can read.
  const adminDoc = json(await request('GET', `${root}/${report.id}/preview`, 'qa-admin'));
  assert.deepEqual([adminDoc.periodStart, adminDoc.periodEnd], [periodStart, addUtcDays(today, -1)]);
  // No Sites chosen: an ADMIN gets every Site (earlier tests add some), by name.
  const allSites = (await prisma.site.findMany({ select: { id: true }, orderBy: { name: 'asc' } })).map(({ id }) => id);
  assert.ok(allSites.includes(ids.siteA) && allSites.includes(ids.siteB));
  assert.deepEqual(adminDoc.sites.map((site: ReportSite) => site.siteId), allSites);
  for (const site of adminDoc.sites as ReportSite[]) {
    assert.deepEqual(reportFigures(site), await sourceFigures('qa-admin', site.siteId, adminDoc, site.lifecycle), `admin, ${site.siteName}`);
  }
  const siteA = (adminDoc.sites as ReportSite[]).find((site) => site.siteId === ids.siteA)!;
  assert.ok(siteA.compliance.expected >= 1 && siteA.compliance.onTime >= 1, 'the seeded on-time attestation counts');
  assert.deepEqual([siteA.changes.completed, siteA.changes.failed], [1, 1]);
  assert.ok(siteA.lifecycle.items.some((item: any) => item.deviceName === 'HTTP Switch A' && item.kind === 'WARRANTY'));
  assert.equal((adminDoc.sites as ReportSite[]).find((site) => site.siteId === ids.siteB)!.changes.rolledBack, 1);

  const scopedDoc = json(await request('GET', `/api/v1/reports/subscriptions/${report.id}/preview`, 'qa-network-scoped'));
  assert.deepEqual(scopedDoc.sites.map((site: ReportSite) => site.siteId), [ids.siteA], 'a scoped recipient gets only the Sites they can read');
  assert.deepEqual(reportFigures(scopedDoc.sites[0]), await sourceFigures('qa-network-scoped', ids.siteA, scopedDoc, scopedDoc.sites[0].lifecycle));
  assert.equal((await request('GET', `/api/v1/reports/subscriptions/${report.id}/preview`, 'qa-readonly')).statusCode, 404, 'only recipients');

  // CSV on demand.
  const csv = await request('GET', `/api/v1/reports/subscriptions/${report.id}/csv`, 'qa-network-scoped');
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers['content-type']), /^text\/csv/);
  assert.match(String(csv.headers['content-disposition']), /attachment; filename="relatorio-operacao-semanal-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.ok(csv.body.includes('HTTP Site A') && !csv.body.includes('HTTP Site B'));
  assert.equal((await request('GET', `${root}/${report.id}/csv`, 'qa-admin')).statusCode, 200);

  // Send now: one e-mail per recipient with their own Sites, CSV attached and List-Unsubscribe; one Teams post without figures.
  const run = await request('POST', `${root}/${report.id}/run`, 'qa-admin');
  assert.equal(run.statusCode, 200, run.body);
  const sent = json(run);
  assert.deepEqual(Object.fromEntries(sent.recipients.map((item: any) => [item.userId, [item.siteIds, item.email]])), { [ids.admin]: [allSites, 'QUEUED'], [ids.scoped]: [[ids.siteA], 'QUEUED'] });
  assert.equal(sent.teams, 'QUEUED');
  await delivery.kick();
  const mails = Object.fromEntries(smtp.calls.map((call) => [call.mail.to[0], call.mail]));
  assert.deepEqual(Object.keys(mails).sort(), ['admin@example.pt', 'scoped@example.pt']);
  const scopedMail = mails['scoped@example.pt'];
  assert.match(scopedMail.subject, /^Relatório semanal: Operação semanal \(/);
  assert.ok(scopedMail.text.includes('HTTP Site A') && !scopedMail.text.includes('HTTP Site B'));
  assert.ok(!scopedMail.html.includes('HTTP Site B'));
  assert.equal(scopedMail.attachments.length, 1);
  assert.match(scopedMail.attachments[0].filename, /\.csv$/);
  assert.ok(scopedMail.attachments[0].content.includes('HTTP Site A') && !scopedMail.attachments[0].content.includes('HTTP Site B'));
  assert.ok(mails['admin@example.pt'].attachments[0].content.includes('HTTP Site B'));
  const unsubscribeHeader = scopedMail.headers['List-Unsubscribe'] as string;
  const match = /^<https:\/\/mgmt\.example\.pt\/relatorios\/cancelar-subscricao\?token=([A-Za-z0-9_-]+)>$/.exec(unsubscribeHeader);
  assert.ok(match, unsubscribeHeader);
  assert.ok(scopedMail.html.includes(`cancelar-subscricao?token=${match![1]}`), 'the body carries the same link');
  assert.equal(teams.calls.length, 1);
  assert.equal(teams.calls[0].url, TEAMS_ALERTS_URL);
  const teamsText = JSON.stringify(teams.calls[0].body);
  assert.ok(teamsText.includes('Operação semanal') && teamsText.includes('https://mgmt.example.pt/perfil?tab=notifications'));
  assert.ok(!teamsText.includes('HTTP Site') && !teamsText.includes('Step 32 done A') && !teamsText.includes('HTTP Switch'), 'no figures or names in the shared channel');
  assert.equal(await prisma.notificationDelivery.count({ where: { topic: 'SCHEDULED_REPORT', status: 'SENT' } }), 3);

  // The unsubscribe link: GET only reads (mail scanners), POST unsubscribes, no sign-in needed; bad tokens are 404.
  const token = match![1];
  assert.equal((await request('GET', '/api/v1/reports/unsubscribe?token=not-a-real-token-at-all-xx')).statusCode, 404);
  assert.deepEqual(json(await request('GET', `/api/v1/reports/unsubscribe?token=${token}`)), { reportName: 'Operação semanal', subscribed: true });
  assert.deepEqual(json(await request('GET', `/api/v1/reports/unsubscribe?token=${token}`)), { reportName: 'Operação semanal', subscribed: true }, 'GET changes nothing');
  const unsubscribed = await request('POST', '/api/v1/reports/unsubscribe', undefined, { token });
  assert.equal(unsubscribed.statusCode, 200, unsubscribed.body);
  assert.equal(json(unsubscribed).subscribed, false);
  assert.equal(json(await request('GET', '/api/v1/reports/subscriptions', 'qa-network-scoped')).items[0].subscribed, false);
  assert.ok(json(await request('GET', root, 'qa-admin')).reports[0].recipients.find((item: any) => item.userId === ids.scoped).unsubscribedAt);

  smtp.calls.length = 0;
  const second = json(await request('POST', `${root}/${report.id}/run`, 'qa-admin'));
  assert.deepEqual(second.recipients.map((item: any) => item.userId), [ids.admin], 'unsubscribed recipients get nothing');
  await delivery.kick();
  assert.deepEqual(smtp.calls.map((call) => call.mail.to[0]), ['admin@example.pt']);

  // An ADMIN edit keeps the person's choice; the profile toggle subscribes again.
  assert.equal((await request('PUT', `${root}/${report.id}`, 'qa-admin', { ...definition, name: 'Operação semanal' })).statusCode, 200);
  assert.equal(json(await request('GET', '/api/v1/reports/subscriptions', 'qa-network-scoped')).items[0].subscribed, false);
  assert.equal((await request('PATCH', `/api/v1/reports/subscriptions/${report.id}`, 'qa-readonly', { subscribed: true })).statusCode, 404);
  const toggled = await request('PATCH', `/api/v1/reports/subscriptions/${report.id}`, 'qa-network-scoped', { subscribed: true });
  assert.deepEqual(json(toggled), { reportId: report.id, subscribed: true });
  smtp.calls.length = 0;
  await request('POST', `${root}/${report.id}/run`, 'qa-admin');
  await delivery.kick();
  assert.deepEqual(smtp.calls.map((call) => call.mail.to[0]).sort(), ['admin@example.pt', 'scoped@example.pt']);

  // Unsubscribing after the e-mail was queued still stops it at send time.
  await prisma.notificationDelivery.updateMany({ where: { topic: 'SCHEDULED_REPORT' }, data: { status: 'SENT' } });
  const kick = delivery.kick;
  delivery.kick = async () => undefined; // hold the queue so the unsubscribe lands between queueing and sending
  let queued: Awaited<ReturnType<typeof reports.run>>;
  try { queued = await reports.run(report.id, 'MANUAL', null); } finally { delivery.kick = kick; }
  await prisma.scheduledReportRecipient.update({ where: { reportId_userId: { reportId: report.id, userId: ids.scoped } }, data: { unsubscribedAt: new Date() } });
  await delivery.kick();
  const late = await prisma.notificationDelivery.findFirstOrThrow({ where: { dedupKey: `report:${queued.runId}:EMAIL:${ids.scoped}` } });
  assert.deepEqual([late.status, late.failureReason], ['FAILED', 'REPORT_UNSUBSCRIBED']);
  assert.equal((await prisma.notificationDelivery.findFirstOrThrow({ where: { dedupKey: `report:${queued.runId}:EMAIL:${ids.admin}` } })).status, 'SENT');

  // The scheduler sends a due report once and moves it to the next slot.
  await prisma.scheduledReport.update({ where: { id: report.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
  const runsBefore = await prisma.scheduledReportRun.count({ where: { reportId: report.id } });
  await Promise.all([reports.tick(), reports.tick()]);
  assert.equal(await prisma.scheduledReportRun.count({ where: { reportId: report.id, trigger: 'SCHEDULE' } }), 1);
  assert.equal(await prisma.scheduledReportRun.count({ where: { reportId: report.id } }), runsBefore + 1);
  const after = await prisma.scheduledReport.findUniqueOrThrow({ where: { id: report.id } });
  assert.ok(after.nextRunAt!.getTime() > Date.now() && after.lastRunAt);

  // Deleting the definition removes recipients and outputs; the audit trail stays.
  assert.equal((await request('DELETE', `${root}/${report.id}`, 'qa-admin')).statusCode, 200);
  assert.equal(await prisma.scheduledReportRecipient.count(), 0);
  assert.equal(await prisma.scheduledReportOutput.count(), 0);
  const actions = (await prisma.auditLog.findMany({ where: { entityType: 'ScheduledReport' }, select: { action: true } })).map((row) => row.action);
  for (const action of ['SCHEDULED_REPORT_CREATED', 'SCHEDULED_REPORT_UPDATED', 'SCHEDULED_REPORT_RUN', 'SCHEDULED_REPORT_UNSUBSCRIBED', 'SCHEDULED_REPORT_SUBSCRIBED', 'SCHEDULED_REPORT_DELETED']) assert.ok(actions.includes(action), action);
});

test('Step 36 tags: site-scoped catalogue, RBAC, audit, device and subnet filters, Site mismatch and cascade on delete', async () => {
  const create = async (siteId: string, name: string, color: string, persona = 'qa-admin') => request('POST', '/api/v1/tags', persona, { siteId, name, color });
  const core = json(await create(ids.siteA, 'core', 'blue'));
  const dmz = json(await create(ids.siteA, '  dmz  ', 'red'));
  const lab = json(await create(ids.siteB, 'lab', 'green'));
  assert.equal(dmz.name, 'dmz');
  const duplicate = await create(ids.siteA, 'CORE', 'gray');
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  assert.equal(json(duplicate).code, 'TAG_NAME_TAKEN');
  assert.equal((await create(ids.siteB, 'core', 'gray')).statusCode, 201, 'the same name is free on another Site');
  assert.equal((await create(ids.siteA, 'x', 'violet')).statusCode, 400);
  assert.equal((await create(ids.siteA, 'ro', 'gray', 'qa-readonly')).statusCode, 403);
  assert.equal((await create(ids.siteA, 'audit', 'gray', 'qa-auditor')).statusCode, 403);

  const readable = await request('GET', `/api/v1/tags?siteId=${ids.siteA}`, 'qa-readonly');
  assert.equal(readable.statusCode, 200, readable.body);
  assert.deepEqual(json(readable).map((tag: { name: string }) => tag.name), ['core', 'dmz']);
  assert.ok([403, 404].includes((await request('GET', `/api/v1/tags?siteId=${ids.siteB}`, 'qa-readonly')).statusCode), 'no access to Site B');

  const put = (kind: 'devices' | 'subnets', id: string, tagIds: string[], persona = 'qa-admin') => request('PUT', `/api/v1/${kind}/${id}/tags`, persona, { tagIds });
  const setA = await put('devices', ids.deviceA, [core.id]);
  assert.equal(setA.statusCode, 200, setA.body);
  assert.deepEqual(json(setA).tags.map((tag: { name: string }) => tag.name), ['core']);
  assert.equal((await put('devices', ids.deviceA2, [dmz.id, core.id])).statusCode, 200);
  const mismatch = await put('devices', ids.deviceA, [lab.id]);
  assert.equal(mismatch.statusCode, 400);
  assert.equal(json(mismatch).code, 'TAG_SITE_MISMATCH');
  assert.equal((await put('devices', ids.deviceA, [core.id], 'qa-readonly')).statusCode, 403);
  assert.equal((await put('devices', ids.deviceA, [core.id], 'qa-systems-scoped')).statusCode, 403, 'read-only scope cannot tag');

  const deviceNames = async (tag: string, persona = 'qa-admin') => {
    const response = await request('GET', `/api/v1/devices?siteId=${ids.siteA}&tag=${tag}`, persona);
    assert.equal(response.statusCode, 200, response.body);
    return json(response).items.map((item: { name: string; tags: Array<{ name: string }> }) => `${item.name}:${item.tags.map((t) => t.name).join('+')}`).sort();
  };
  assert.deepEqual(await deviceNames(core.id), ['HTTP Switch A2:core+dmz', 'HTTP Switch A:core']);
  assert.deepEqual(await deviceNames(`${core.id},${dmz.id}`), ['HTTP Switch A2:core+dmz']);
  assert.deepEqual(await deviceNames(core.id, 'qa-systems-scoped'), ['HTTP Switch A2:core+dmz', 'HTTP Switch A:core']);
  const badFilter = await request('GET', `/api/v1/devices?siteId=${ids.siteA}&tag=nope`, 'qa-admin');
  assert.equal(badFilter.statusCode, 400);
  assert.equal(json(badFilter).code, 'TAG_FILTER_INVALID');
  const single = json(await request('GET', `/api/v1/devices/${ids.deviceA}`, 'qa-admin'));
  assert.deepEqual(single.tags.map((tag: { name: string }) => tag.name), ['core']);

  const subnetSet = await put('subnets', ids.subnetA, [dmz.id], 'qa-network-scoped');
  assert.equal(subnetSet.statusCode, 200, subnetSet.body);
  assert.notEqual((await put('subnets', ids.subnetB, [lab.id], 'qa-network-scoped')).statusCode, 200, 'no write access to Site B');
  const subnets = await request('GET', `/api/v1/subnets?siteId=${ids.siteA}&tag=${dmz.id}`, 'qa-network-scoped');
  assert.equal(subnets.statusCode, 200, subnets.body);
  assert.deepEqual(json(subnets).items.map((item: { cidr: string }) => item.cidr), ['10.250.1.0/24']);
  assert.deepEqual(json(await request('GET', `/api/v1/subnets?siteId=${ids.siteA}&tag=${core.id}`, 'qa-admin')).items, []);
  assert.deepEqual(json(await request('GET', `/api/v1/subnets/${ids.subnetA}`, 'qa-admin')).tags.map((tag: { name: string }) => tag.name), ['dmz']);

  // NETWORK_OPERATOR assigns existing tags (above) but cannot change the Site catalog: deleting a tag would reach servers too.
  assert.equal((await create(ids.siteA, 'net', 'gray', 'qa-network-scoped')).statusCode, 403, 'NETWORK_OPERATOR cannot create tags');
  assert.equal((await request('PATCH', `/api/v1/tags/${core.id}`, 'qa-network-scoped', { name: 'hijack', color: 'red' })).statusCode, 403, 'NETWORK_OPERATOR cannot rename or recolour tags');
  assert.equal((await request('DELETE', `/api/v1/tags/${dmz.id}`, 'qa-network-scoped')).statusCode, 403, 'NETWORK_OPERATOR cannot delete tags');
  assert.deepEqual(json(await request('GET', `/api/v1/tags?siteId=${ids.siteA}`, 'qa-network-scoped')).map((tag: { name: string; color: string }) => `${tag.name}:${tag.color}`), ['core:blue', 'dmz:red'], 'catalog unchanged, still readable');

  const renamed = await request('PATCH', `/api/v1/tags/${core.id}`, 'qa-admin', { name: 'backbone', color: 'purple' });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(json(renamed).deviceCount, 2);
  assert.equal((await request('DELETE', `/api/v1/tags/${dmz.id}`, 'qa-admin')).statusCode, 200);
  assert.deepEqual(json(await request('GET', `/api/v1/devices/${ids.deviceA2}`, 'qa-admin')).tags.map((tag: { name: string }) => tag.name), ['backbone']);
  assert.deepEqual(json(await request('GET', `/api/v1/subnets/${ids.subnetA}`, 'qa-admin')).tags, []);

  const actions = (await prisma.auditLog.findMany({ where: { action: { in: ['TAG_CREATED', 'TAG_UPDATED', 'TAG_DELETED', 'DEVICE_TAGS_UPDATED', 'SUBNET_TAGS_UPDATED'] } }, select: { action: true, metadata: true } }));
  const count = (action: string) => actions.filter((entry) => entry.action === action).length;
  assert.equal(count('TAG_CREATED'), 4);
  assert.equal(count('TAG_UPDATED'), 1);
  assert.equal(count('TAG_DELETED'), 1);
  assert.equal(count('DEVICE_TAGS_UPDATED'), 2);
  assert.equal(count('SUBNET_TAGS_UPDATED'), 1);
  const deleted = actions.find((entry) => entry.action === 'TAG_DELETED')?.metadata as { removedFromDevices: number; removedFromSubnets: number };
  assert.deepEqual([deleted.removedFromDevices, deleted.removedFromSubnets], [1, 1]);
});

test('Round 2 #18 rack U reservations: validated, conflict-checked, scoped, audited, and counted in the capacity outlook', async () => {
  const admin = 'qa-admin';
  const failure = (response: { statusCode: number; body: string }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(json(response).code, code); };
  const created = await request('POST', '/api/v1/racks', admin, { name: 'Reservations Rack', roomId: ids.roomA });
  assert.equal(created.statusCode, 201, created.body);
  const rackId = json(created).id as string;
  await prisma.device.create({ data: { name: 'r2-18-srv', type: 'SERVER', siteId: ids.siteA, rackId, rackUnitStart: 1, rackUnitSize: 2, status: 'ACTIVE' } });
  const url = `/api/v1/racks/${rackId}/unit-reservations`;
  const outlookSpace = async () => (json(await request('GET', `/api/v1/sites/${ids.siteA}/capacity-outlook`, 'qa-readonly')).items as any[]).find((item) => item.kind === 'RACK_SPACE' && item.id === rackId);
  const before = await outlookSpace();
  assert.equal(before.reservedUnits, 0);

  failure(await request('POST', url, admin, { startUnit: 2, size: 2, reason: 'Novo servidor' }), 409, 'RACK_UNITS_OCCUPIED');
  failure(await request('POST', url, admin, { startUnit: 41, size: 4, reason: 'Novo servidor' }), 400, 'RACK_UNIT_RESERVATION_OUT_OF_RANGE');
  failure(await request('POST', url, admin, { startUnit: 10, size: 2, reason: 'Novo servidor', expiresAt: '2020-01-01T00:00:00.000Z' }), 400, 'RACK_UNIT_RESERVATION_EXPIRED');
  assert.equal((await request('POST', url, admin, { startUnit: 0, size: 2, reason: 'Novo servidor' })).statusCode, 400);
  assert.equal((await request('POST', url, admin, { startUnit: 10, size: 2 })).statusCode, 400);
  assert.equal((await request('POST', url, 'qa-readonly', { startUnit: 10, size: 4, reason: 'Novo servidor' })).statusCode, 403);
  assert.equal((await request('GET', `/api/v1/racks/${ids.rackSibling}/unit-reservations`, 'qa-systems-scoped')).statusCode, 404);
  assert.equal((await request('GET', '/api/v1/racks/not-a-uuid/unit-reservations', admin)).statusCode, 400);

  const reserved = await request('POST', url, admin, { startUnit: 10, size: 4, reason: 'Storage planeado Q1' });
  assert.equal(reserved.statusCode, 201, reserved.body);
  const reservationId = json(reserved).id as string;
  failure(await request('POST', url, admin, { startUnit: 12, size: 4, reason: 'Outro' }), 409, 'RACK_UNIT_RESERVATION_OVERLAP');
  const listed = await request('GET', url, 'qa-readonly');
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(json(listed).map((item: any) => [item.startUnit, item.size, item.reason, item.createdBy?.username]), [[10, 4, 'Storage planeado Q1', 'qa-admin']]);

  const during = await outlookSpace();
  assert.equal(during.reservedUnits, 4);
  assert.ok(during.currentPercent > before.currentPercent, `${during.currentPercent} > ${before.currentPercent}`);

  assert.equal((await request('DELETE', `${url}/${reservationId}`, 'qa-readonly')).statusCode, 403);
  assert.equal((await request('DELETE', `${url}/99999999-0000-4000-8000-000000000018`, admin)).statusCode, 404);
  const released = await request('DELETE', `${url}/${reservationId}`, admin);
  assert.equal(released.statusCode, 200, released.body);
  assert.equal((await request('DELETE', `${url}/${reservationId}`, admin)).statusCode, 200);
  assert.deepEqual(json(await request('GET', url, admin)), []);
  assert.equal((await outlookSpace()).reservedUnits, 0);

  const audit = await prisma.auditLog.findMany({ where: { entityType: 'Rack', entityId: rackId, action: { in: ['RACK_UNITS_RESERVED', 'RACK_UNIT_RESERVATION_RELEASED'] } }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(audit.map((entry) => entry.action), ['RACK_UNITS_RESERVED', 'RACK_UNIT_RESERVATION_RELEASED']);
});

test('D-P1a discovery SNMP enrichment: off by default, ADMIN-only, one READ credential on the subnet Site, audited, secrets never returned', async () => {
  const envelope = () => encryptCredential({ community: 'http-dp1a-secret' }, testKeyring);
  const readA = await prisma.snmpCredential.create({ data: { deviceId: ids.deviceA, purpose: 'READ', version: 'V2C', label: 'A read', ...envelope() } });
  const writeA = await prisma.snmpCredential.create({ data: { deviceId: ids.deviceA, purpose: 'WRITE', version: 'V2C', ...envelope() } });
  const disabledA2 = await prisma.snmpCredential.create({ data: { deviceId: ids.deviceA2, purpose: 'READ', version: 'V2C', enabled: false, ...envelope() } });
  const readB = await prisma.snmpCredential.create({ data: { deviceId: ids.deviceB, purpose: 'READ', version: 'V2C', ...envelope() } });
  const path = `/api/v1/subnets/${ids.subnetA}/discovery-snmp`;
  try {
    const initial = await request('GET', path, 'qa-admin');
    assert.equal(initial.statusCode, 200, initial.body);
    const view = json(initial);
    assert.deepEqual([view.enabled, view.credentialId, view.credential], [false, null, null]);
    assert.deepEqual(view.candidates.map((item: { id: string }) => item.id), [readA.id], 'only enabled READ credentials on the subnet Site');
    assert.equal(initial.body.includes('http-dp1a-secret') || initial.body.includes('ciphertext'), false);
    assert.equal((await request('GET', path, 'qa-network-scoped')).statusCode, 200);
    assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetB}/discovery-snmp`, 'qa-network-scoped')).statusCode, 404, 'another Site stays hidden');

    for (const persona of ['qa-network-scoped', 'qa-auditor', 'qa-readonly']) assert.equal((await request('PATCH', path, persona, { credentialId: readA.id })).statusCode, 403, persona);
    for (const [credentialId, code] of [[writeA.id, 'DISCOVERY_SNMP_CREDENTIAL_NOT_READ'], [disabledA2.id, 'DISCOVERY_SNMP_CREDENTIAL_DISABLED'], [readB.id, 'DISCOVERY_SNMP_CREDENTIAL_OUT_OF_SCOPE'], ['00000000-0000-4000-8000-0000000000ff', 'DISCOVERY_SNMP_CREDENTIAL_NOT_FOUND']]) {
      const response = await request('PATCH', path, 'qa-admin', { credentialId });
      assert.equal(response.statusCode, 400, response.body); assert.equal(json(response).code, code);
    }
    assert.equal((await request('PATCH', path, 'qa-admin', { credentialId: 'nope' })).statusCode, 400);
    assert.equal((await prisma.subnet.findUniqueOrThrow({ where: { id: ids.subnetA } })).discoverySnmpCredentialId, null);

    const on = await request('PATCH', path, 'qa-admin', { credentialId: readA.id });
    assert.equal(on.statusCode, 200, on.body);
    assert.deepEqual([json(on).enabled, json(on).credential.id, json(on).credential.deviceName], [true, readA.id, 'HTTP Switch A']);
    assert.equal(on.body.includes('http-dp1a-secret'), false);
    assert.equal((await request('PATCH', path, 'qa-admin', { credentialId: readA.id })).statusCode, 200);
    const off = await request('PATCH', path, 'qa-admin', { credentialId: null });
    assert.equal(off.statusCode, 200, off.body); assert.equal(json(off).enabled, false);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Subnet', entityId: ids.subnetA, action: 'DISCOVERY_SNMP_ENRICHMENT_UPDATED' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audit.map((entry) => [entry.userId, (entry.metadata as { enabled: boolean }).enabled, (entry.metadata as { credentialId: string | null }).credentialId]), [[ids.admin, true, readA.id], [ids.admin, false, null]], 'one audit row per change; a no-op save writes none');
  } finally {
    await prisma.subnet.update({ where: { id: ids.subnetA }, data: { discoverySnmpCredentialId: null } });
    await prisma.snmpCredential.deleteMany({ where: { id: { in: [readA.id, writeA.id, disabledA2.id, readB.id] } } });
  }
});

test('D-P1a + #176: a READ credential picked for discovery SNMP enrichment is in use; delete returns 409 unless forced', async () => {
  const credential = await prisma.snmpCredential.create({ data: { deviceId: ids.deviceA, purpose: 'READ', version: 'V2C', ...encryptCredential({ community: 'http-dp1a-inuse' }, testKeyring) } });
  const url = (query = '') => `/api/v1/snmp/devices/${ids.deviceA}/credentials/READ${query}`;
  try {
    assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetA}/discovery-snmp`, 'qa-admin', { credentialId: credential.id })).statusCode, 200);

    const refused = await request('DELETE', url(), 'qa-admin');
    assert.equal(refused.statusCode, 409, refused.body);
    assert.equal(json(refused).code, 'SNMP_CREDENTIAL_IN_USE');
    const usage = json(refused).details.usages.find((item: { type: string }) => item.type === 'DISCOVERY_ENRICHMENT');
    assert.deepEqual([usage?.deviceId, usage?.deviceName, usage?.subnetId, usage?.subnetCidr], [ids.deviceA, 'HTTP Switch A', ids.subnetA, '10.250.1.0/24']);
    assert.equal(refused.body.includes('http-dp1a-inuse'), false);
    assert.equal((await request('DELETE', url('?force=false'), 'qa-admin')).statusCode, 409);
    assert.ok(await prisma.snmpCredential.findUnique({ where: { id: credential.id } }), 'nothing deleted without force');

    const forced = await request('DELETE', url('?force=true'), 'qa-admin');
    assert.equal(forced.statusCode, 200, forced.body);
    assert.equal(json(forced).forced, true);
    assert.ok(json(forced).usages.some((item: { type: string }) => item.type === 'DISCOVERY_ENRICHMENT'));
    assert.equal(await prisma.snmpCredential.findUnique({ where: { id: credential.id } }), null);
    assert.equal((await prisma.subnet.findUniqueOrThrow({ where: { id: ids.subnetA } })).discoverySnmpCredentialId, null, 'enrichment turns off with the credential (FK SET NULL)');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SNMP_CREDENTIAL_FORCE_DELETED', entityId: credential.id } });
    assert.ok((audit.metadata as { usages: Array<{ type: string }> }).usages.some((item) => item.type === 'DISCOVERY_ENRICHMENT'));
    const view = json(await request('GET', `/api/v1/subnets/${ids.subnetA}/discovery-snmp`, 'qa-admin'));
    assert.deepEqual([view.enabled, view.credentialId], [false, null]);
  } finally {
    await prisma.subnet.update({ where: { id: ids.subnetA }, data: { discoverySnmpCredentialId: null } });
    await prisma.snmpCredential.deleteMany({ where: { id: credential.id } });
  }
});

test('Discovery D-P1d: discovery candidates show their LLDP/CDP neighbour evidence and link proposals, inside the caller scope', async () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const pollJobs: string[] = [];
  const snapshot = async (deviceId: string, observedAt: Date) => {
    const job = await prisma.snmpJob.create({ data: { deviceId, type: 'POLL', status: 'COMPLETED' } });
    pollJobs.push(job.id);
    return prisma.snmpSnapshot.create({ data: { deviceId, jobId: job.id, observedAt } });
  };
  const jobA = await prisma.discoveryJob.create({ data: { name: 'D-P1d site A run', subnetId: ids.subnetA, methods: ['ICMP'], tcpPorts: [], status: 'COMPLETED' } });
  const jobB = await prisma.discoveryJob.create({ data: { name: 'D-P1d site B run', subnetId: ids.subnetB, methods: ['ICMP'], tcpPorts: [], status: 'COMPLETED' } });
  const candidate = await prisma.discoveryResult.create({ data: { jobId: jobA.id, address: '10.250.1.60', hostname: 'ap-new.example', icmpReachable: true, openPorts: [] } });
  const registered = await prisma.discoveryResult.create({ data: { jobId: jobA.id, address: '10.250.1.3', icmpReachable: true, openPorts: [] } });
  await prisma.discoveryResult.create({ data: { jobId: jobA.id, address: '10.250.1.61', icmpReachable: true, openPorts: [] } });
  await prisma.discoveryResult.create({ data: { jobId: jobB.id, address: '10.250.1.60', icmpReachable: true, openPorts: [] } });
  const snapA1 = await snapshot(ids.deviceA, minutesAgo(120));
  const snapA2 = await snapshot(ids.deviceA, minutesAgo(5));
  const snapSibling = await snapshot(ids.deviceSibling, minutesAgo(10));
  const snapB = await snapshot(ids.deviceB, minutesAgo(10));
  const seen = (deviceId: string, snapshotId: string, observedAt: Date, extra: Record<string, unknown>) => prisma.lldpObservation.create({ data: { deviceId, snapshotId, observedAt, confidence: 95, rawIdentifiers: {}, ...extra } as never });
  const uplink = await seen(ids.deviceA, snapA1.id, minutesAgo(120), { localPortNumber: 49, localPortId: 'Te1/1/1', remoteSystemName: 'HTTP Switch A2', remotePortId: 'Te1/0/1', managementAddress: '10.250.1.3', resolvedDeviceId: ids.deviceA2 });
  const apCdp = await seen(ids.deviceA, snapA2.id, minutesAgo(5), { protocol: 'CDP', confidence: 90, localPortNumber: 1, localPortId: 'Gi1/0/1', remoteSystemName: 'ap-new', remotePortId: 'GigabitEthernet0', managementAddress: '10.250.1.60' });
  await seen(ids.deviceA, snapA1.id, minutesAgo(120), { protocol: 'CDP', confidence: 90, localPortNumber: 1, localPortId: 'Gi1/0/1', remoteSystemName: 'ap-new', managementAddress: '10.250.1.60' });
  await seen(ids.deviceA, snapA1.id, minutesAgo(8 * 24 * 60), { localPortNumber: 2, localPortId: 'Gi1/0/2', remoteSystemName: 'too-old', managementAddress: '10.250.1.61' });
  const hidden = await seen(ids.deviceSibling, snapSibling.id, minutesAgo(10), { localPortNumber: 7, localPortId: 'Gi1/0/7', remoteSystemName: 'ap-new', managementAddress: '10.250.1.60' });
  await seen(ids.deviceB, snapB.id, minutesAgo(10), { localPortNumber: 3, localPortId: 'Gi1/0/3', remoteSystemName: 'ap-new', managementAddress: '10.250.1.60' });
  const linkProposal = await prisma.topologyProposal.create({ data: { deviceId: ids.deviceA, snapshotId: snapA1.id, action: 'CONNECTION_ADD', proposalKey: `connection:${ids.deviceA}:${ids.deviceA2}`, confidence: 95, context: { observationId: uplink.id, siteId: ids.siteA, protocol: 'LLDP' }, observedValues: { siteId: ids.siteA, sourceDeviceId: ids.deviceA, targetDeviceId: ids.deviceA2 } } });
  try {
    const url = `/api/v1/snmp/discovery/jobs/${jobA.id}/neighbors`;
    const admin = await request('GET', url, 'qa-admin');
    assert.equal(admin.statusCode, 200, admin.body);
    const body = json(admin);
    assert.equal(body.siteId, ids.siteA);
    assert.equal(body.windowDays, 7);
    assert.deepEqual(body.results.map((item: any) => [item.address, item.resultId, item.status]), [['10.250.1.3', registered.id, 'PENDING'], ['10.250.1.60', candidate.id, 'PENDING']], '.61 was only seen 8 days ago; deviceB is on another Site');
    const [linked, candidateRow] = body.results;
    assert.equal(linked.neighbors.length, 1);
    assert.deepEqual([linked.neighbors[0].resolution, linked.neighbors[0].current, linked.neighbors[0].observer.deviceId, linked.neighbors[0].observer.localPortId], ['RESOLVED', false, ids.deviceA, 'Te1/1/1'], 'seen in an older poll, not the latest');
    assert.deepEqual(linked.neighbors[0].devices, [{ id: ids.deviceA2, name: 'HTTP Switch A2' }]);
    assert.deepEqual([linked.neighbors[0].proposal.id, linked.neighbors[0].proposal.status, linked.neighbors[0].proposal.match], [linkProposal.id, 'PENDING', 'OBSERVATION']);
    assert.deepEqual(candidateRow.neighbors.map((item: any) => [item.observationId, item.protocol, item.current, item.resolution, item.proposal]), [[apCdp.id, 'CDP', true, 'UNREGISTERED', null], [hidden.id, 'LLDP', true, 'UNREGISTERED', null]]);
    assert.equal(candidateRow.neighbors[0].confidence, 90);
    assert.deepEqual(candidateRow.neighbors[0].remote, { systemName: 'ap-new', portId: 'GigabitEthernet0', chassisId: null });

    // Read-only users see room A only, so the sibling room's switch and its sighting are left out.
    for (const persona of ['qa-readonly', 'qa-auditor']) {
      const scoped = await request('GET', url, persona);
      assert.equal(scoped.statusCode, 200, scoped.body);
      assert.deepEqual(json(scoped).results.find((item: any) => item.address === '10.250.1.60').neighbors.map((item: any) => item.observer.deviceId), [ids.deviceA], persona);
    }
    assert.equal((await request('GET', url, 'qa-network-scoped')).statusCode, 200);
    assert.ok([403, 404].includes((await request('GET', `/api/v1/snmp/discovery/jobs/${jobB.id}/neighbors`, 'qa-network-scoped')).statusCode), 'site B run is outside the scoped operator');
    const missing = await request('GET', '/api/v1/snmp/discovery/jobs/99999999-0000-4000-8000-000000000099/neighbors', 'qa-admin');
    assert.equal(missing.statusCode, 404, missing.body); assert.equal(json(missing).code, 'DISCOVERY_JOB_NOT_FOUND');
    assert.equal((await request('GET', '/api/v1/snmp/discovery/jobs/not-a-uuid/neighbors', 'qa-admin')).statusCode, 400);
    const siteBRun = json(await request('GET', `/api/v1/snmp/discovery/jobs/${jobB.id}/neighbors`, 'qa-admin'));
    assert.deepEqual(siteBRun.results.map((item: any) => [item.address, item.neighbors.map((neighbor: any) => neighbor.observer.deviceId)]), [['10.250.1.60', [ids.deviceB]]], 'the same address on site B only shows site B sightings');

    // The reverse link: each LLDP/CDP row carries the newest discovery result for its address on the same Site.
    const observations = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/lldp-observations`, 'qa-network-scoped');
    assert.equal(observations.statusCode, 200, observations.body);
    const byId = new Map(json(observations).map((item: any) => [item.id, item]));
    assert.deepEqual((byId.get(apCdp.id) as any).discoveryCandidate, { resultId: candidate.id, jobId: jobA.id, subnetId: ids.subnetA, status: 'PENDING', hostname: 'ap-new.example', icmpReachable: true, discoveredAt: candidate.createdAt.toISOString() });
    assert.equal((byId.get(uplink.id) as any).discoveryCandidate.resultId, registered.id);

    // Read-only: nothing was applied or created.
    assert.equal(await prisma.topologyProposal.count({ where: { deviceId: { in: [ids.deviceA, ids.deviceA2, ids.deviceSibling] } } }), 1);
    assert.equal((await prisma.topologyProposal.findUniqueOrThrow({ where: { id: linkProposal.id } })).status, 'PENDING');
  } finally {
    await prisma.topologyProposal.deleteMany({ where: { id: linkProposal.id } });
    await prisma.lldpObservation.deleteMany({ where: { snapshotId: { in: [snapA1.id, snapA2.id, snapSibling.id, snapB.id] } } });
    await prisma.snmpSnapshot.deleteMany({ where: { id: { in: [snapA1.id, snapA2.id, snapSibling.id, snapB.id] } } });
    await prisma.snmpJob.deleteMany({ where: { id: { in: pollJobs } } });
    await prisma.discoveryResult.deleteMany({ where: { jobId: { in: [jobA.id, jobB.id] } } });
    await prisma.discoveryJob.deleteMany({ where: { id: { in: [jobA.id, jobB.id] } } });
  }
});

test('D-P1e: ARP and MAC forwarding sightings are read-only, device-scoped and never hidden-device leaks', async () => {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const laptop = '00:a3:d1:ee:00:50';
  const arpRow = (deviceId: string, ipAddress: string, macAddress: string, lastSeenAt: Date) => ({ deviceId, ipAddress, macAddress, ifIndex: 2, interfaceName: 'Gi1/0/2', entryType: 'DYNAMIC', source: 'IP-MIB', firstSeenAt: at(600), lastSeenAt });
  const macRow = (deviceId: string, vlanId: number, macAddress: string, lastSeenAt: Date) => ({ deviceId, vlanId, macAddress, bridgePort: 2, ifIndex: 2, interfaceName: 'Gi1/0/2', status: 'LEARNED', source: vlanId ? 'Q-BRIDGE-MIB' : 'BRIDGE-MIB', firstSeenAt: at(600), lastSeenAt });
  const now = at(1), older = at(90);
  await prisma.snmpArpEntry.createMany({ data: [arpRow(ids.deviceA, '10.250.1.50', laptop, now), arpRow(ids.deviceA, '10.250.1.51', '00:a3:d1:ee:00:51', older), arpRow(ids.deviceSibling, '10.250.1.50', laptop, now)] });
  await prisma.snmpMacEntry.createMany({ data: [macRow(ids.deviceA, 70, laptop, now), macRow(ids.deviceA, 80, laptop, now), macRow(ids.deviceA, 0, '00:a3:d1:ee:00:51', older), macRow(ids.deviceSibling, 70, laptop, now)] });
  try {
    const own = await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/endpoints`, 'qa-readonly');
    assert.equal(own.statusCode, 200, own.body);
    const body = json(own);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.arp.map((row: any) => [row.ipAddress, row.macAddress, row.interfaceName, row.current]), [['10.250.1.50', laptop, 'Gi1/0/2', true], ['10.250.1.51', '00:a3:d1:ee:00:51', 'Gi1/0/2', false]]);
    assert.deepEqual(body.mac.map((row: any) => [row.vlanId, row.macAddress, row.current]), [[70, laptop, true], [80, laptop, true], [null, '00:a3:d1:ee:00:51', false]], 'one MAC in two VLANs is two sightings; VLAN 0 is reported as unknown');
    assert.equal((await request('GET', `/api/v1/snmp/devices/${ids.deviceA}/endpoints`, 'qa-auditor')).statusCode, 200);
    assert.ok([403, 404].includes((await request('GET', `/api/v1/snmp/devices/${ids.deviceSibling}/endpoints`, 'qa-readonly')).statusCode), 'hidden device');
    assert.equal((await request('GET', '/api/v1/snmp/devices/not-a-uuid/endpoints', 'qa-admin')).statusCode, 400);

    const scoped = json(await request('GET', `/api/v1/snmp/endpoints?mac=00A3.D1EE.0050`, 'qa-readonly'));
    assert.deepEqual(scoped.query, { mac: laptop });
    assert.deepEqual([...new Set([...scoped.arp, ...scoped.mac].map((row: any) => row.deviceId))], [ids.deviceA], 'the sibling room device is left out');
    const admin = json(await request('GET', `/api/v1/snmp/endpoints?mac=${laptop}`, 'qa-admin'));
    assert.deepEqual(new Set(admin.arp.map((row: any) => row.deviceId)), new Set([ids.deviceA, ids.deviceSibling]));
    assert.equal(admin.mac.length, 3);
    assert.deepEqual([...admin.arp, ...admin.mac].map((row: any) => row.current), [true, true, true, true, true], 'each sighting is from its device\'s newest poll');
    const byIp = json(await request('GET', '/api/v1/snmp/endpoints?ip=10.250.1.50', 'qa-readonly'));
    assert.deepEqual(byIp.arp.map((row: any) => row.macAddress), [laptop]);
    assert.deepEqual(byIp.mac.map((row: any) => row.vlanId).sort(), [70, 80], 'the IP leads to its MAC in the forwarding table');
    for (const query of ['', '?mac=nope', '?ip=10.250.1', '?ip=fe80::1', `?mac=${laptop}&ip=10.250.1.50`]) {
      const refused = await request('GET', `/api/v1/snmp/endpoints${query}`, 'qa-readonly');
      assert.equal(refused.statusCode, 400, query);
      assert.equal(json(refused).code, 'SNMP_ENDPOINT_QUERY_INVALID');
    }
    assert.ok([404, 405].includes((await request('POST', `/api/v1/snmp/devices/${ids.deviceA}/endpoints`, 'qa-admin', {})).statusCode), 'no write route');
    assert.equal(await prisma.device.count({ where: { managementIp: '10.250.1.50' } }), 0, 'a sighting never becomes a Device');
  } finally {
    await prisma.snmpArpEntry.deleteMany({ where: { deviceId: { in: [ids.deviceA, ids.deviceSibling] } } });
    await prisma.snmpMacEntry.deleteMany({ where: { deviceId: { in: [ids.deviceA, ids.deviceSibling] } } });
  }
});
test('D-P1c identity candidates: suggestion-only, ranked with reasons, scoped to the devices the caller may read', async () => {
  const visibleId = '92000000-0000-4000-8000-0000000d1c01', hiddenId = '92000000-0000-4000-8000-0000000d1c02';
  await prisma.device.createMany({ data: [
    { id: visibleId, name: 'DP1C Switch', hostname: 'dp1c-sw1.lab.local', serialNumber: 'FOCDP1C001', type: 'SWITCH', siteId: ids.siteA, rackId: ids.rackA },
    { id: hiddenId, name: 'DP1C Hidden Switch', serialNumber: 'FOCDP1C002', type: 'SWITCH', siteId: ids.siteA, rackId: ids.rackSibling },
  ] });
  const job = await prisma.discoveryJob.create({ data: { name: 'D-P1c identity', subnetId: ids.subnetA, methods: ['ICMP'], tcpPorts: [], status: 'COMPLETED' } });
  const snmp = (fields: Record<string, string>) => ({ status: 'OK', credentialId: '00000000-0000-4000-8000-00000000c0de', observedAt: new Date().toISOString(), durationMs: 5, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value, oid: '1.3.6.1', source: 'SNMP', credentialId: '00000000-0000-4000-8000-00000000c0de', observedAt: new Date().toISOString() }])) });
  const bySerial = await prisma.discoveryResult.create({ data: { jobId: job.id, address: '10.250.1.150', icmpReachable: true, snmp: snmp({ entitySerial: 'focdp1c001', sysName: 'other-name' }) } });
  const byIp = await prisma.discoveryResult.create({ data: { jobId: job.id, address: '10.250.1.2', icmpReachable: true } });
  const hidden = await prisma.discoveryResult.create({ data: { jobId: job.id, address: '10.250.1.151', icmpReachable: true, snmp: snmp({ entitySerial: 'FOCDP1C002' }) } });
  const conflict = await prisma.discoveryResult.create({ data: { jobId: job.id, address: '10.250.1.152', icmpReachable: true, snmp: snmp({ sysName: 'DP1C-SW1', entitySerial: 'FOCDP1C999' }) } });
  const devicesBefore = await prisma.device.findMany({ where: { id: { in: [visibleId, hiddenId, ids.deviceA] } }, orderBy: { id: 'asc' } });
  type Identity = { signals: string[]; ambiguous: boolean; candidates: { deviceId: string; confidence: string; reasons: { code: string }[] }[] };
  const identities = async (actor: string) => {
    const response = await request('GET', `/api/v1/discovery/jobs/${job.id}/results`, actor);
    assert.equal(response.statusCode, 200, response.body);
    return new Map((json(response) as { id: string; identity: Identity }[]).map((item) => [item.id, item.identity]));
  };
  try {
    // qa-readonly and qa-auditor read room A only; the sibling room's switch must not be suggested to them.
    const scoped = await identities('qa-readonly');
    const serialMatch = scoped.get(bySerial.id)!;
    assert.deepEqual(serialMatch.signals, ['MANAGEMENT_IP', 'SERIAL', 'SYSNAME']);
    assert.deepEqual(serialMatch.candidates.map((item) => [item.deviceId, item.confidence, item.reasons.map((reason) => reason.code).join('+')]), [[visibleId, 'HIGH', 'SERIAL_MATCH']]);
    assert.deepEqual(scoped.get(byIp.id)!.candidates.map((item) => [item.deviceId, item.confidence]), [[ids.deviceA, 'MEDIUM']]);
    assert.deepEqual(scoped.get(byIp.id)!.signals, ['MANAGEMENT_IP']);
    assert.deepEqual(scoped.get(hidden.id)!.candidates, [], 'a device outside the caller scope is never suggested');
    assert.deepEqual(scoped.get(conflict.id)!.candidates.map((item) => [item.deviceId, item.confidence, item.reasons.map((reason) => reason.code).join('+')]), [[visibleId, 'LOW', 'SYSNAME_MATCH+SERIAL_MISMATCH']]);

    const auditor = await identities('qa-auditor');
    assert.equal(auditor.get(bySerial.id)!.candidates[0].deviceId, visibleId);
    assert.deepEqual(auditor.get(hidden.id)!.candidates, []);
    // Callers whose scope covers the sibling room (site-wide write group, ADMIN) do get it.
    for (const actor of ['qa-network-scoped', 'qa-admin']) assert.deepEqual((await identities(actor)).get(hidden.id)!.candidates.map((item) => [item.deviceId, item.confidence]), [[hiddenId, 'HIGH']], actor);

    // Suggestion-only: listing never links, merges, reviews or edits anything.
    assert.deepEqual(await prisma.device.findMany({ where: { id: { in: [visibleId, hiddenId, ids.deviceA] } }, orderBy: { id: 'asc' } }), devicesBefore);
    assert.deepEqual((await prisma.discoveryResult.findMany({ where: { jobId: job.id } })).map((item) => item.status), ['PENDING', 'PENDING', 'PENDING', 'PENDING']);
  } finally {
    await prisma.discoveryResult.deleteMany({ where: { jobId: job.id } });
    await prisma.discoveryJob.deleteMany({ where: { id: job.id } });
    await prisma.device.deleteMany({ where: { id: { in: [visibleId, hiddenId] } } });
  }
});
