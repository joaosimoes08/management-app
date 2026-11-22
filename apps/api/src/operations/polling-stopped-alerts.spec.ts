import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pollingStoppedAlerts } from './operations-reconciler.service';

// Round 2 #12: silent polling stops become SNMP_POLL alerts on the existing Alertas page.
const now = new Date('2026-11-22T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const row = (deviceId: string, overrides: Record<string, unknown>) => ({ deviceId, enabled: true, intervalMinutes: 15, lastPollAt: ago(5), nextPollAt: ago(-10), lastErrorCode: null, device: { siteId: 'site-1', name: deviceId }, ...overrides });

test('one alert per device whose scheduler is missing or whose polls stopped; healthy devices raise nothing', () => {
  const alerts = pollingStoppedAlerts([
    row('healthy', {}),
    row('no-scheduler', { nextPollAt: null, lastErrorCode: 'SNMP_QUEUE_UNAVAILABLE' }),
    row('stale', { lastPollAt: ago(40), nextPollAt: ago(25) }),
  ] as never, now);
  assert.deepEqual(alerts.map((alert) => alert.dedupKey), ['snmp:polling-stopped:no-scheduler', 'snmp:polling-stopped:stale']);
  assert.ok(alerts.every((alert) => alert.source === 'SNMP_POLL' && alert.actionHref === '/snmp' && alert.entityType === 'Device'));
  assert.match(alerts[0].detail ?? '', /SNMP_QUEUE_UNAVAILABLE/);
  assert.equal(alerts[1].title, 'Polling SNMP parado em stale');
});
