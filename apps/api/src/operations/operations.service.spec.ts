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
  };
  const service = new OperationsService(prisma as never, {} as never, {} as never, {} as never);
  const result = await service.list({ id: 'admin', roles: ['ADMIN'] } as never);
  assert.deepEqual(result.items.map((item) => [item.entityType, item.entityId, item.relatedDeviceId]), [
    ['SnmpJob', 'job', 'device-a'], ['SnmpDrift', 'drift', 'device-b'], ['SnmpTrapEvent', 'trap', 'device-c'],
  ]);
});

test('acknowledge, snooze and resolve preserve global operational state transitions', async () => {
  const updates: any[] = [];
  const prisma = { operationalAlert: { findUnique: async () => ({ id: 'alert', siteId: null }), update: async (args: any) => { updates.push(args.data); return args.data; } } };
  const audit = { record: async () => undefined };
  const service = new OperationsService(prisma as never, {} as never, {} as never, audit as never);
  const user = { id: 'user', externalId: 'external', username: 'operator', roles: ['ADMIN'] as const };
  await service.acknowledge(user as never, 'alert');
  await service.snooze(user as never, 'alert', { until: '2030-01-01T00:00:00.000Z' });
  await service.resolve(user as never, 'alert', { reason: 'corrigido' });
  assert.equal(updates[0].status, 'ACKNOWLEDGED');
  assert.equal(updates[1].status, 'SNOOZED');
  assert.equal(updates[2].status, 'RESOLVED');
  assert.equal(updates[2].resolutionReason, 'corrigido');
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
