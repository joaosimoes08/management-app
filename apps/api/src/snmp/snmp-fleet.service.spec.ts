import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { summarizeSnmpFleet } from './snmp-fleet.service';

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
  assert.deepEqual(summary.attention.map((item) => [item.name, item.reason]), [['edge-1', 'FAILED'], ['fw-1', 'STALE'], ['new-1', 'NEVER_POLLED']]);
});
