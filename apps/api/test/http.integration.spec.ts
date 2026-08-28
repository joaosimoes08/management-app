import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { CanActivate, ConflictException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@simoes/database';
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
const json = (response: { body: string }) => JSON.parse(response.body);
const request = (method: string, url: string, persona?: string, payload?: unknown) => app.inject({
  method: method as never,
  url,
  headers: { ...(persona ? { 'x-test-user': persona } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) },
  payload: payload ? JSON.stringify(payload) : undefined,
});

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "Notification", "RoleRequest", "ApplicationLinkRole", "ApplicationLink", "RipeImport", "IpamPermission", "IpamGroupMember", "IpamGroup",
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
  ] as const;
  for (const [id, username, role] of personas) await prisma.user.create({ data: { id, externalId: `http-${username}`, username, roles: { create: { role } } } });
  await prisma.site.createMany({ data: [{ id: ids.siteA, name: 'HTTP Site A', code: 'HTTP-A' }, { id: ids.siteB, name: 'HTTP Site B', code: 'HTTP-B' }] });
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
  await prisma.ipamGroup.createMany({ data: [
    { id: ids.groupRead, name: 'HTTP Scoped Read', siteId: ids.siteA },
    { id: ids.groupWrite, name: 'HTTP Scoped Write', siteId: ids.siteA },
  ] });
  await prisma.ipamGroupMember.createMany({ data: [{ groupId: ids.groupRead, userId: ids.scoped }, { groupId: ids.groupWrite, userId: ids.scoped }] });
  await prisma.ipamPermission.createMany({ data: [
    { groupId: ids.groupRead, scopeType: 'SITE', scopeId: ids.siteA, permission: 'READ' },
    { groupId: ids.groupWrite, scopeType: 'SUBNET', scopeId: ids.subnetA, permission: 'CREATE' },
    { groupId: ids.groupWrite, scopeType: 'SUBNET', scopeId: ids.subnetA, permission: 'UPDATE' },
    { groupId: ids.groupWrite, scopeType: 'SUBNET', scopeId: ids.subnetA, permission: 'DISCOVER' },
  ] });
}

before(async () => {
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
});

test('enforces authentication and persona-level RBAC over HTTP', async () => {
  assert.equal((await request('GET', '/api/v1/sites')).statusCode, 401);
  assert.equal((await request('GET', '/api/v1/sites', 'qa-readonly')).statusCode, 200);
  assert.equal((await request('POST', '/api/v1/ip-addresses', 'qa-readonly', { address: '10.250.1.20', subnetId: ids.subnetA })).statusCode, 403);
  assert.equal((await request('GET', '/api/v1/audit/events', 'qa-auditor')).statusCode, 200);
  assert.equal((await request('POST', '/api/v1/ip-addresses', 'qa-auditor', { address: '10.250.1.21', subnetId: ids.subnetA })).statusCode, 403);
});

test('applies scoped visibility, inherited reads, group union, and legacy fallback', async () => {
  const visible = await request('GET', '/api/v1/sites?pageSize=20', 'qa-network-scoped');
  assert.equal(visible.statusCode, 200);
  assert.deepEqual(json(visible).items.map((site: { id: string }) => site.id), [ids.siteA]);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetA}`, 'qa-network-scoped')).statusCode, 200);
  assert.equal((await request('GET', `/api/v1/subnets/${ids.subnetB}`, 'qa-network-scoped')).statusCode, 404);
  assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetA}`, 'qa-network-scoped', { purpose: 'Scoped update' })).statusCode, 200);
  assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetB}`, 'qa-network-scoped', { purpose: 'Denied update' })).statusCode, 403);
  assert.equal((await request('PATCH', `/api/v1/subnets/${ids.subnetB}`, 'qa-network-legacy', { purpose: 'Legacy update' })).statusCode, 200);
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

  const duplicate = await request('POST', '/api/v1/settings/role-requests', 'qa-readonly', { roles: ['STORAGE_OPERATOR'] });
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
