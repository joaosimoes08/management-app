import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { OperationsService } from './operations.service';
import { AlertSeverityDto } from './dto';

const input = { dedupKey: 'discovery:failed:1', source: 'DISCOVERY', severity: AlertSeverityDto.WARNING, siteId: 'site', title: 'Falha', detail: 'Discovery falhou' };

test('upsert uses the stable key, increments occurrences and reopens resolved alerts', async () => {
  let args: any;
  const prisma = { operationalAlert: { findUnique: async () => ({ status: 'RESOLVED' }), upsert: async (value: any) => { args = value; return { id: 'alert', siteId: 'site' }; } }, operationalAlertUserState: { updateMany: async () => ({ count: 0 }) } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  await service.upsert(input);
  assert.deepEqual(args.where, { dedupKey: input.dedupKey });
  assert.equal(args.update.status, 'OPEN');
  assert.deepEqual(args.update.occurrenceCount, { increment: 1 });
  assert.equal(args.update.resolvedAt, null);
});

test('upsert preserves acknowledged and snoozed workflow state for active alerts', async () => {
  let args: any;
  const prisma = { operationalAlert: { findUnique: async () => ({ status: 'ACKNOWLEDGED' }), upsert: async (value: any) => { args = value; return { id: 'alert', siteId: 'site' }; } }, operationalAlertUserState: { updateMany: async () => ({ count: 0 }) } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  await service.upsert(input);
  assert.equal(args.update.status, undefined);
  assert.equal(args.update.acknowledgedAt, undefined);
  assert.deepEqual(args.update.occurrenceCount, { increment: 1 });
});

test('list includes related device ids for SNMP alerts without changing their source entities', async () => {
  const prisma = {
    site: { findMany: async () => [] },
    alertRule: { findMany: async () => [] },
    maintenanceWindow: { findMany: async () => [] },
    operationalAlert: { findMany: async () => [
      { id: 'job-alert', siteId: 'site', entityType: 'SnmpJob', entityId: 'job', userStates: [] },
      { id: 'drift-alert', siteId: 'site', entityType: 'SnmpDrift', entityId: 'drift', userStates: [] },
      { id: 'trap-alert', siteId: 'site', entityType: 'SnmpTrapEvent', entityId: 'trap', userStates: [] },
    ] },
    snmpJob: { findMany: async () => [{ id: 'job', deviceId: 'device-a' }] },
    snmpDrift: { findMany: async () => [{ id: 'drift', deviceId: 'device-b' }] },
    snmpTrapEvent: { findMany: async () => [{ id: 'trap', deviceId: 'device-c' }] },
    device: { findMany: async () => [{ id: 'device-a', name: 'SW-A', managementIp: '10.0.0.1' }, { id: 'device-b', name: 'SW-B', managementIp: null }, { id: 'device-c', name: 'SW-C', managementIp: '10.0.0.3' }] },
  };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const result = await service.list({ id: 'admin', roles: ['ADMIN'] } as never);
  assert.deepEqual(result.items.map((item) => [item.entityType, item.entityId, item.relatedDeviceId]), [
    ['SnmpJob', 'job', 'device-a'], ['SnmpDrift', 'drift', 'device-b'], ['SnmpTrapEvent', 'trap', 'device-c'],
  ]);
  assert.deepEqual(result.items.map((item) => item.device), [
    { id: 'device-a', name: 'SW-A', managementIp: '10.0.0.1' }, { id: 'device-b', name: 'SW-B', managementIp: null }, { id: 'device-c', name: 'SW-C', managementIp: '10.0.0.3' },
  ]);
});

test('list names the device of interface and device alerts, and leaves alerts without a device empty', async () => {
  const deviceQueries: any[] = [];
  const prisma = {
    site: { findMany: async () => [] },
    alertRule: { findMany: async () => [] },
    maintenanceWindow: { findMany: async () => [] },
    operationalAlert: { findMany: async () => [
      { id: 'if-alert', siteId: 'site', entityType: 'DeviceInterface', entityId: 'if-1', userStates: [] },
      { id: 'dev-alert', siteId: 'site', entityType: 'Device', entityId: 'device-b', userStates: [] },
      { id: 'sys-alert', siteId: null, entityType: null, entityId: null, userStates: [] },
    ] },
    deviceInterface: { findMany: async () => [{ id: 'if-1', deviceId: 'device-a' }] },
    device: { findMany: async (args: any) => { deviceQueries.push(args); return [{ id: 'device-a', name: 'Core-1', managementIp: '10.1.1.1' }]; } },
  };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const result = await service.list({ id: 'admin', roles: ['ADMIN'] } as never);
  assert.deepEqual(result.items.map((item) => item.relatedDeviceId), ['device-a', 'device-b', null]);
  assert.deepEqual(result.items[0].device, { id: 'device-a', name: 'Core-1', managementIp: '10.1.1.1' });
  // A device that no longer exists keeps its id so the row still says which device it was.
  assert.deepEqual(result.items[1].device, { id: 'device-b', name: '', managementIp: null });
  assert.equal(result.items[2].device, null);
  assert.equal(deviceQueries.length, 1);
});

test('acknowledge, snooze and resolve preserve global operational state transitions', async () => {
  const updates: any[] = [];
  const prisma = { operationalAlert: { findUnique: async () => ({ id: 'alert', siteId: null }), update: async (args: any) => { updates.push(args.data); return args.data; } } };
  const audit = { record: async () => undefined };
  const service = new OperationsService(prisma as never, {} as never, {} as never, audit as never);
  const user = { id: 'user', externalId: 'external', username: 'operator', roles: ['ADMIN'] as const };
  await service.acknowledge(user as never, 'alert');
  await service.snooze(user as never, 'alert', { until: new Date(Date.now() + 3_600_000).toISOString() });
  await service.resolve(user as never, 'alert', { reason: 'corrigido' });
  assert.equal(updates[0].status, 'ACKNOWLEDGED');
  assert.equal(updates[1].status, 'SNOOZED');
  assert.equal(updates[2].status, 'RESOLVED');
  assert.equal(updates[2].resolutionReason, 'corrigido');
});

test('snooze accepts a duration in hours and rejects ambiguous or past ends', async () => {
  const updates: any[] = []; const audits: any[] = [];
  const prisma = { operationalAlert: { findUnique: async () => ({ id: 'alert', siteId: null }), update: async (args: any) => { updates.push(args.data); return args.data; } } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, { record: async (entry: any) => { audits.push(entry); } } as never);
  const admin = { id: 'user', roles: ['ADMIN'] } as never;
  const before = Date.now();
  await service.snooze(admin, 'alert', { durationHours: 4, reason: 'janela' });
  const until = updates[0].snoozedUntil as Date;
  assert.ok(Math.abs(until.getTime() - (before + 4 * 3_600_000)) < 5_000);
  assert.equal(updates[0].snoozeReason, 'janela');
  assert.equal(audits[0].action, 'OPERATIONAL_ALERT_SNOOZED');
  await assert.rejects(service.snooze(admin, 'alert', { until: '2030-01-01T00:00:00.000Z', durationHours: 1 }), /mas não ambas/);
  await assert.rejects(service.snooze(admin, 'alert', {}), /mas não ambas/);
  await assert.rejects(service.snooze(admin, 'alert', { until: '2020-01-01T00:00:00.000Z' }), /futura/);
  await assert.rejects(service.snooze(admin, 'alert', { durationHours: 721 }), /entre 1 hora e 30 dias/);
  assert.equal(updates.length, 1);
});

test('bulk acts on each alert on its own and reports per-item failures', async () => {
  const alerts: Record<string, any> = { a: { id: 'a', siteId: null }, b: { id: 'b', siteId: null }, global: { id: 'global', siteId: null } };
  const updates: Array<[string, any]> = [];
  const prisma = { operationalAlert: { findUnique: async ({ where }: any) => alerts[where.id] ?? null, update: async ({ where, data }: any) => { updates.push([where.id, data]); return { id: where.id, ...data }; } } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, { record: async () => undefined } as never);
  const admin = { id: 'user', roles: ['ADMIN'] } as never;

  const snoozed = await service.bulk(admin, { action: 'SNOOZE', ids: ['a', 'missing', 'b'], durationHours: 24 });
  assert.equal(snoozed.succeeded, 2);
  assert.equal(snoozed.failed, 1);
  assert.deepEqual(snoozed.results.map((item) => [item.id, item.ok, item.code ?? item.status]), [['a', true, 'SNOOZED'], ['missing', false, 'NOT_FOUND'], ['b', true, 'SNOOZED']]);
  assert.ok(snoozed.snoozedUntil);

  const resolved = await service.bulk(admin, { action: 'RESOLVE', ids: ['a'], reason: 'corrigido em massa' });
  assert.equal(resolved.results[0].status, 'RESOLVED');
  assert.equal(updates.at(-1)![1].resolutionReason, 'corrigido em massa');

  const acknowledged = await service.bulk(admin, { action: 'ACKNOWLEDGE', ids: ['b'] });
  assert.equal(acknowledged.results[0].status, 'ACKNOWLEDGED');

  // Global alerts need ADMIN: an operator gets FORBIDDEN for that item, not a failed batch.
  const operator = { id: 'op', roles: ['NETWORK_OPERATOR'] } as never;
  const denied = await service.bulk(operator, { action: 'ACKNOWLEDGE', ids: ['global'] });
  assert.deepEqual(denied.results[0], { id: 'global', ok: false, code: 'FORBIDDEN', message: 'Apenas ADMIN pode alterar alertas globais' });
});

test('bulk refuses fields that do not belong to the action, before touching any alert', async () => {
  let touched = false;
  const prisma = { operationalAlert: { findUnique: async () => { touched = true; return null; } } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const admin = { id: 'user', roles: ['ADMIN'] } as never;
  await assert.rejects(service.bulk(admin, { action: 'ACKNOWLEDGE', ids: ['a'], durationHours: 1 }), /SNOOZE/);
  await assert.rejects(service.bulk(admin, { action: 'ACKNOWLEDGE', ids: ['a'], reason: 'x' }), /SNOOZE e RESOLVE/);
  await assert.rejects(service.bulk(admin, { action: 'SNOOZE', ids: ['a'] }), /mas não ambas/);
  assert.equal(touched, false);
});

test('detail returns the device, history and whether the user may act; hidden alerts are 404', async () => {
  const alert = { id: 'alert', siteId: 'site', entityType: 'SnmpTrapEvent', entityId: 'trap', source: 'SNMP_TRAP', site: { id: 'site', name: 'LX' } };
  const history = [{ id: 'h1', action: 'OPERATIONAL_ALERT_ACKNOWLEDGED', metadata: null, createdAt: new Date('2026-11-23T10:00:00Z'), user: { id: 'u', username: 'ana', displayName: 'Ana' } }];
  let historyQuery: any;
  const prisma = {
    operationalAlert: { findUnique: async () => alert },
    snmpTrapEvent: { findMany: async () => [{ id: 'trap', deviceId: 'device-1' }], findUnique: async () => ({ deviceId: 'device-1' }) },
    device: { findMany: async () => [{ id: 'device-1', name: 'C9300', managementIp: '10.0.0.9' }] },
    auditLog: { findMany: async (args: any) => { historyQuery = args; return history; } },
  };
  const service = new OperationsService(prisma as never, { assertDevice: async () => undefined } as never, {} as never, {} as never);
  const result = await service.detail({ id: 'admin', roles: ['ADMIN'] } as never, 'alert');
  assert.deepEqual(result.device, { id: 'device-1', name: 'C9300', managementIp: '10.0.0.9' });
  assert.equal(result.relatedDeviceId, 'device-1');
  assert.equal(result.canAct, true);
  assert.deepEqual(result.history, history);
  assert.deepEqual(historyQuery.where, { entityType: 'OperationalAlert', entityId: 'alert' });

  const denied = { assertSite: async () => { throw new Error('no access'); }, assertDevice: async () => undefined };
  const deniedService = new OperationsService(prisma as never, denied as never, {} as never, {} as never);
  const readOnly = await deniedService.detail({ id: 'viewer', roles: ['READ_ONLY'] } as never, 'alert').catch((error) => error);
  // A user without access to the Site cannot see the alert at all.
  assert.equal(readOnly.status, 404);

  const access = { assertSite: async () => undefined, assertDevice: async () => undefined };
  const viewerService = new OperationsService(prisma as never, access as never, {} as never, {} as never);
  const viewer = await viewerService.detail({ id: 'viewer', roles: ['READ_ONLY'] } as never, 'alert');
  assert.equal(viewer.canAct, false);

  const missing = new OperationsService({ operationalAlert: { findUnique: async () => null } } as never, {} as never, {} as never, {} as never);
  await assert.rejects(missing.detail({ id: 'admin', roles: ['ADMIN'] } as never, 'nope'), /Alerta não encontrado/);
});

test('alert sources list the known producers plus any stored source, without duplicates', async () => {
  const prisma = { operationalAlert: { findMany: async () => [{ source: 'SNMP_TRAP' }, { source: 'SNMP_UNREACHABLE' }] } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const { items } = await service.sources();
  assert.equal(items.filter((item) => item === 'SNMP_TRAP').length, 1);
  assert.ok(items.includes('SNMP_INTERFACE'));
  assert.ok(items.includes('CAPACITY'));
  assert.ok(items.includes('SNMP_TRAP_SOURCE'), 'traps nobody accepts (#145)');
  assert.equal(items.at(-1), 'SNMP_UNREACHABLE');
});

test('a truncated reconciliation batch never resolves alerts omitted by the limit', async () => {
  let queriedForStale = false;
  const prisma = { operationalAlert: { findMany: async () => { queriedForStale = true; return []; } } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const result = await service.reconcileSource('SNMP_TRAP', [], undefined, false);
  assert.equal(queriedForStale, false);
  assert.deepEqual(result, { active: 0, resolved: 0 });
});

test('expired snoozes reopen and publish their state change', async () => {
  let update: any;
  const prisma = { operationalAlert: { findMany: async () => [{ id: 'alert', siteId: 'site' }], updateMany: async (args: any) => { update = args; return { count: 1 }; } } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const result = await service.reopenExpiredSnoozes(new Date('2030-01-01T00:00:00.000Z'));
  assert.equal(result.reopened, 1);
  assert.equal(update.data.status, 'OPEN');
  assert.equal(update.data.snoozedUntil, null);
});

test('SSE heartbeat advertises Pub/Sub loss and recovery for client polling fallback', async () => {
  const prisma = { site: { findMany: async () => [] }, operationalAlert: { findMany: async () => [] } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never) as any;
  let tick: (() => void) | undefined;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  global.setInterval = ((callback: () => void) => { tick = callback; return 1 as any; }) as typeof setInterval;
  global.clearInterval = (() => undefined) as typeof clearInterval;
  const received: any[] = [];
  const subscription = service.stream({ id: 'user', roles: ['ADMIN'] }).subscribe((event: any) => received.push(event));
  try {
    service.publisherReady = true;
    service.subscriberReady = false; tick?.();
    assert.equal(received.at(-1).type, 'heartbeat');
    assert.equal(received.at(-1).data.pubSubAvailable, false);
    service.subscriberReady = true; tick?.();
    assert.equal(received.at(-1).data.pubSubAvailable, true);
  } finally {
    subscription.unsubscribe(); global.setInterval = originalSetInterval; global.clearInterval = originalClearInterval;
  }
});

test('publisher disconnect and publish failure disable heartbeat Pub/Sub readiness until recovery', async () => {
  const prisma = { site: { findMany: async () => [] }, operationalAlert: { findMany: async () => [] } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never) as any;
  const publisher = new EventEmitter();
  service.subscriptionEstablished = true;
  service.trackReadiness(publisher, 'publisher');
  service.subscriberReady = true;
  publisher.emit('ready');
  assert.equal(service.pubSubReady, true);

  publisher.emit('reconnecting');
  assert.equal(service.pubSubReady, false);
  publisher.emit('ready');
  assert.equal(service.pubSubReady, true);

  const localEvents: any[] = [];
  service.events.subscribe((event: any) => localEvents.push(event));
  service.publisher = { status: 'ready', publish: async () => { throw new Error('connection lost'); } };
  await service.publish({ type: 'alert.updated', occurredAt: new Date().toISOString() });
  assert.equal(service.publisherReady, false);
  assert.equal(localEvents.length, 1);
  assert.equal(service.pubSubReady, false);

  publisher.emit('ready');
  assert.equal(service.pubSubReady, true);
});

test('maintenance windows silence non-critical alerts but always preserve critical alerts', async () => {
  const prisma = { alertRule: { findMany: async () => [] }, maintenanceWindow: { findMany: async () => [{ siteId: 'site' }] } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never) as any;
  const items = [
    { source: 'SNMP', siteId: 'site', severity: 'WARNING' },
    { source: 'SNMP', siteId: 'site', severity: 'CRITICAL' },
    { source: 'SNMP', siteId: 'other', severity: 'WARNING' },
  ];
  const result = await service.applyAlertPolicies(items);
  assert.deepEqual(result.map((item: any) => item.severity), ['CRITICAL', 'WARNING']);
});

test('configured source and site thresholds filter lower severities while preserving critical alerts', async () => {
  const prisma = { alertRule: { findMany: async () => [{ source: 'SNMP', siteId: 'site', minSeverity: 'HIGH' }] }, maintenanceWindow: { findMany: async () => [] } };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never) as any;
  const result = await service.applyAlertPolicies([
    { source: 'SNMP', siteId: 'site', severity: 'WARNING' },
    { source: 'SNMP', siteId: 'site', severity: 'HIGH' },
    { source: 'SNMP', siteId: 'site', severity: 'CRITICAL' },
  ]);
  assert.deepEqual(result.map((item: any) => item.severity), ['HIGH', 'CRITICAL']);
});

test('site-specific alert rules override global rules deterministically', async () => {
  const prisma = {
    alertRule: { findMany: async () => [
      { source: 'SNMP', siteId: null, minSeverity: 'CRITICAL' },
      { source: 'SNMP', siteId: 'site', minSeverity: 'WARNING' },
      { source: 'SNMP', siteId: 'site', minSeverity: 'INFO' },
    ] },
    maintenanceWindow: { findMany: async () => [] },
  };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never) as any;
  const result = await service.applyAlertPolicies([
    { source: 'SNMP', siteId: 'site', severity: 'INFO' },
    { source: 'SNMP', siteId: 'other', severity: 'INFO' },
  ]);
  assert.deepEqual(result.map((item: any) => item.siteId), ['site']);
});
