import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as queue from './delivery/delivery-queue';
import { groupDeliveryReadiness, queueAlertDelivery } from './delivery/delivery-queue';

// SNMP Phase 1 step 1.2: no hard-coded channel or severity default; an unset group channel sends nothing.
const teamsGroup = (minSeverity: string | null, enabled = true) => ({ kind: 'TEAMS', target: 'GROUP_ALERTS', enabled, keyId: enabled ? 'k1' : null, minSeverity, settings: {} });
const alert = (severity: string) => ({ id: 'a1', source: 'SNMP_POLL', severity, siteId: null, title: 't', detail: 'd', actionHref: null, firstOccurredAt: new Date(), lastOccurredAt: new Date() });

function db(rows: unknown[]) {
  const created: any[] = [];
  return {
    created,
    deliveryChannelConfig: { findMany: async () => rows },
    alertRule: { findMany: async () => [] },
    maintenanceWindow: { findMany: async () => [] },
    site: { findUnique: async () => null },
    notificationDelivery: { createMany: async ({ data }: any) => { created.push(...data); return { count: data.length }; } },
  };
}

test('the code has no default group severity any more', () => {
  assert.equal((queue as Record<string, unknown>).DEFAULT_GROUP_MIN_SEVERITY, undefined);
});

test('a group channel without a saved minimum severity sends nothing, not even CRITICAL', async () => {
  const store = db([teamsGroup(null)]);
  assert.equal(await queueAlertDelivery(store as never, alert('CRITICAL') as never, new Date()), false);
  assert.equal(store.created.length, 0);
});

test('with a saved severity the channel sends at or above it only', async () => {
  const store = db([teamsGroup('CRITICAL')]);
  assert.equal(await queueAlertDelivery(store as never, alert('HIGH') as never, new Date()), false);
  assert.notEqual(await queueAlertDelivery(store as never, alert('CRITICAL') as never, new Date()), false);
  assert.deepEqual(store.created.map((row) => row.channel), ['TEAMS']);
});

test('readiness tells the setup page what is missing', () => {
  assert.deepEqual(groupDeliveryReadiness(null, null), { ready: false, missing: ['enabled', 'destination', 'minSeverity'] });
  assert.deepEqual(groupDeliveryReadiness(teamsGroup(null) as never, null), { ready: false, missing: ['minSeverity'] });
  assert.deepEqual(groupDeliveryReadiness(teamsGroup('HIGH') as never, null), { ready: true, missing: [] });
  assert.deepEqual(groupDeliveryReadiness({ kind: 'EMAIL', target: 'GROUP_ALERTS', enabled: true, keyId: null, minSeverity: 'HIGH', settings: { recipients: ['noc@example.pt'] } } as never, null), { ready: false, missing: ['destination'] }, 'e-mail needs the SMTP server too');
});
