import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { snmpPollingStopReason, summarizeSnmpFleet } from './snmp-fleet.service';

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
