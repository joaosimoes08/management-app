import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { parseHealthDeviceIds, SNMP_HEALTH_MAX_DEVICE_IDS, snmpPollingStopReason, summarizeSnmpFleet, summarizeSnmpHealth } from './snmp-fleet.service';

const now = new Date('2026-11-21T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const config = (overrides: Record<string, unknown>) => ({ enabled: true, intervalMinutes: 15, lastPollAt: minutesAgo(5), nextPollAt: null, lastStatus: 'COMPLETED', lastErrorCode: null, ...overrides });

test('fleet summary counts configuration, poll status, staleness and drift', () => {
  const summary = summarizeSnmpFleet([
    { id: '1', name: 'core-1', type: 'SWITCH', siteId: 'a', snmpConfig: config({}) as never, pendingDrifts: 2 },
    { id: '2', name: 'edge-1', type: 'ROUTER', siteId: 'a', snmpConfig: config({ lastStatus: 'FAILED', lastErrorCode: 'TIMEOUT' }) as never, pendingDrifts: 0 },
    { id: '3', name: 'fw-1', type: 'FIREWALL', siteId: 'b', snmpConfig: config({ lastPollAt: minutesAgo(31) }) as never, pendingDrifts: 1 },
    { id: '4', name: 'new-1', type: 'SWITCH', siteId: 'b', snmpConfig: config({ lastPollAt: null, lastStatus: null }) as never, pendingDrifts: 0 },
    { id: '5', name: 'off-1', type: 'SWITCH', siteId: 'b', snmpConfig: config({ enabled: false }) as never, pendingDrifts: 0 },
    { id: '6', name: 'bare-1', type: 'SWITCH', siteId: 'b', snmpConfig: null, pendingDrifts: 0 },
  ], now);
  assert.deepEqual(summary.devices, { total: 6, configured: 5, enabled: 4, disabled: 1, notConfigured: 1 });
  assert.deepEqual(summary.polling.byStatus, { PENDING: 0, RUNNING: 0, COMPLETED: 2, FAILED: 1, BLOCKED: 0, NEVER_POLLED: 1 });
  assert.equal(summary.polling.stale, 1);
  assert.deepEqual(summary.polling.lastPollAt, minutesAgo(5));
  assert.deepEqual(summary.polling.oldestPollAt, minutesAgo(31));
  assert.deepEqual(summary.drift, { pending: 3, devicesWithPending: 2 });
  assert.deepEqual(summary.attention.map((item) => [item.name, item.reason]), [['edge-1', 'FAILED'], ['fw-1', 'STALE'], ['new-1', 'NEVER_POLLED'], ['bare-1', 'NOT_CONFIGURED']]);
});

// Round 2 #12: polling that stopped silently is surfaced.
test('fleet summary flags devices without a poll scheduler and never-polled devices whose first poll is long overdue', () => {
  const summary = summarizeSnmpFleet([
    { id: '1', name: 'queue-down', type: 'SWITCH', siteId: 'a', snmpConfig: config({ nextPollAt: null, lastErrorCode: 'SNMP_QUEUE_UNAVAILABLE' }) as never, pendingDrifts: 0 },
    { id: '2', name: 'never-scheduled', type: 'SWITCH', siteId: 'a', snmpConfig: config({ lastPollAt: null, lastStatus: null, nextPollAt: null }) as never, pendingDrifts: 0 },
    { id: '3', name: 'first-poll-overdue', type: 'SWITCH', siteId: 'a', snmpConfig: config({ lastPollAt: null, lastStatus: null, nextPollAt: minutesAgo(45) }) as never, pendingDrifts: 0 },
    { id: '4', name: 'first-poll-soon', type: 'SWITCH', siteId: 'a', snmpConfig: config({ lastPollAt: null, lastStatus: null, nextPollAt: minutesAgo(-2) }) as never, pendingDrifts: 0 },
    { id: '5', name: 'healthy', type: 'SWITCH', siteId: 'a', snmpConfig: config({ nextPollAt: minutesAgo(-10) }) as never, pendingDrifts: 0 },
  ], now);
  assert.equal(summary.polling.noSchedule, 1);
  assert.equal(summary.polling.stale, 1);
  assert.deepEqual(summary.attention.map((item) => [item.name, item.reason]), [['queue-down', 'NO_SCHEDULE'], ['first-poll-overdue', 'STALE'], ['first-poll-soon', 'NEVER_POLLED'], ['never-scheduled', 'NEVER_POLLED']]);
});

test('snmpPollingStopReason ignores disabled devices and healthy schedules', () => {
  assert.equal(snmpPollingStopReason({ enabled: false, intervalMinutes: 15, lastPollAt: null, nextPollAt: null, lastErrorCode: 'SNMP_QUEUE_UNAVAILABLE' }, now), null);
  assert.equal(snmpPollingStopReason({ enabled: true, intervalMinutes: 15, lastPollAt: minutesAgo(5), nextPollAt: null, lastErrorCode: 'TIMEOUT' }, now), null);
  assert.equal(snmpPollingStopReason({ enabled: true, intervalMinutes: 15, lastPollAt: minutesAgo(5), nextPollAt: null, lastErrorCode: 'SNMP_SCHEDULER_FAILED' }, now), 'NO_SCHEDULE');
  assert.equal(snmpPollingStopReason({ enabled: true, intervalMinutes: 15, lastPollAt: minutesAgo(31), nextPollAt: minutesAgo(16), lastErrorCode: null }, now), 'STALE');
});

// SNMP Phase 2 step 10: health badges.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reading = (overrides: Record<string, unknown> = {}) => ({ status: 'OK', observedAt: minutesAgo(5), issueCount: 0, rebootDetectedAt: null, ...overrides });

test('health summary maps readings to badge statuses and handles no data', () => {
  const items = summarizeSnmpHealth([
    { id: 'ok', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: reading() as never },
    { id: 'bad', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: reading({ status: 'DEGRADED', issueCount: 2, rebootDetectedAt: minutesAgo(3) }) as never },
    { id: 'unknown', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: reading({ status: 'UNKNOWN' }) as never },
    { id: 'weird', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: reading({ status: 'SOMETHING_NEW' }) as never },
    { id: 'none', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: null },
  ], now);
  assert.deepEqual(items.map((item) => [item.deviceId, item.status, item.issueCount, item.stale]), [['ok', 'OK', 0, false], ['bad', 'DEGRADED', 2, false], ['unknown', 'UNKNOWN', 0, false], ['weird', 'UNKNOWN', 0, false], ['none', null, 0, false]]);
  assert.deepEqual(items[1].rebootDetectedAt, minutesAgo(3));
  assert.equal(items[4].observedAt, null);
});

test('health summary marks readings older than twice the interval, or with polling off, as stale', () => {
  const items = summarizeSnmpHealth([
    { id: 'old', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: reading({ observedAt: minutesAgo(31) }) as never },
    { id: 'edge', snmpConfig: { enabled: true, intervalMinutes: 15 }, snmpHealth: reading({ observedAt: minutesAgo(30) }) as never },
    { id: 'off', snmpConfig: { enabled: false, intervalMinutes: 15 }, snmpHealth: reading() as never },
    { id: 'no-config', snmpConfig: null, snmpHealth: reading() as never },
  ], now);
  assert.deepEqual(items.map((item) => [item.deviceId, item.stale]), [['old', true], ['edge', false], ['off', true], ['no-config', true]]);
});

test('parseHealthDeviceIds accepts a bounded, de-duplicated list of UUIDs', () => {
  assert.equal(parseHealthDeviceIds(undefined), undefined);
  assert.equal(parseHealthDeviceIds(' '), undefined);
  assert.deepEqual(parseHealthDeviceIds(`${uuid(1)}, ${uuid(2)},${uuid(1)},`), [uuid(1), uuid(2)]);
  assert.throws(() => parseHealthDeviceIds('not-a-uuid'), BadRequestException);
  assert.throws(() => parseHealthDeviceIds(Array.from({ length: SNMP_HEALTH_MAX_DEVICE_IDS + 1 }, (_, index) => uuid(index)).join(',')), BadRequestException);
  assert.equal(parseHealthDeviceIds(Array.from({ length: SNMP_HEALTH_MAX_DEVICE_IDS }, (_, index) => uuid(index)).join(','))?.length, SNMP_HEALTH_MAX_DEVICE_IDS);
});
