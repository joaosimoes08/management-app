import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AlertSeverityDto } from './dto';
import { CAPACITY_ALERT_LIMIT, capacityAlertKey, CapacityReading, planCapacityAlerts } from './capacity-alerts';

const reading = (id: string, used: number, total: number, extra: Partial<CapacityReading> = {}): CapacityReading => ({ kind: 'SUBNET', id, name: `10.0.${id}.0/24`, siteId: 'site', entityType: 'Subnet', entityId: id, used, total, actionHref: `/ipam?subnetId=${id}`, ...extra });

test('80 % opens a WARNING, 90 % a CRITICAL, below 80 % nothing', () => {
  const plan = planCapacityAlerts([reading('a', 204, 254), reading('b', 229, 254), reading('c', 150, 254)], new Set());
  assert.deepEqual(plan.candidates.map((item) => [item.dedupKey, item.severity]), [['capacity:subnet:b', AlertSeverityDto.CRITICAL], ['capacity:subnet:a', AlertSeverityDto.WARNING]]);
  assert.equal(plan.candidates[0].title, 'Subnet 10.0.b.0/24 a 90% da capacidade');
  assert.match(plan.candidates[0].detail ?? '', /229 de 254 endereços atribuídos\. Limiares: aviso 80%, crítico 90%\./);
  assert.equal(plan.candidates[0].actionHref, '/ipam?subnetId=b');
  assert.deepEqual(plan.resolveKeys, []);
});

test('hysteresis: an open alert stays open at WARNING until usage drops 5 points below 80 %', () => {
  const open = new Set([capacityAlertKey({ kind: 'SUBNET', id: 'a' }), capacityAlertKey({ kind: 'SUBNET', id: 'b' }), capacityAlertKey({ kind: 'RACK_SPACE', id: 'gone' })]);
  const plan = planCapacityAlerts([reading('a', 77, 100), reading('b', 74, 100), reading('new', 77, 100)], open);
  assert.deepEqual(plan.candidates.map((item) => [item.dedupKey, item.severity]), [['capacity:subnet:a', AlertSeverityDto.WARNING]], 'a new 77 % reading does not open an alert');
  assert.deepEqual(plan.resolveKeys.sort(), ['capacity:rack_space:gone', 'capacity:subnet:b']);
});

test('racks, PDUs and NetApp use their own units; zero capacity with load is critical', () => {
  const plan = planCapacityAlerts([
    reading('r1', 40, 42, { kind: 'RACK_SPACE', name: 'R01', entityType: 'Rack' }),
    reading('p1', 3_700, 4_000, { kind: 'PDU_POWER', name: 'PDU-A', context: 'Bastidor R01', entityType: 'Rack' }),
    reading('v1', 900 * 1024 ** 3, 1000 * 1024 ** 3, { kind: 'NETAPP_VOLUME', name: 'vol_data', entityType: 'NetAppIntegration' }),
    reading('z', 5, 0, { kind: 'RACK_POWER', name: 'R02', entityType: 'Rack' }),
  ], new Set());
  const byKey = Object.fromEntries(plan.candidates.map((item) => [item.dedupKey, item]));
  assert.equal(byKey['capacity:rack_space:r1'].detail, '40 de 42 U ocupadas. Limiares: aviso 80%, crítico 90%.');
  assert.equal(byKey['capacity:pdu_power:p1'].detail, 'Bastidor R01 · 3700 W de 4000 W estimados. Limiares: aviso 80%, crítico 90%.');
  assert.equal(byKey['capacity:netapp_volume:v1'].title, 'Volume NetApp vol_data a 90% da capacidade');
  assert.match(byKey['capacity:netapp_volume:v1'].detail ?? '', /^900 GiB de 1000 GiB usados/);
  assert.equal(byKey['capacity:rack_power:z'].severity, AlertSeverityDto.CRITICAL);
  assert.equal(plan.candidates[0].dedupKey, 'capacity:rack_power:z', 'worst first');
});

test('over the cap: worst first, and open alerts beyond the cap are kept rather than resolved', () => {
  const readings = Array.from({ length: CAPACITY_ALERT_LIMIT + 10 }, (_, index) => reading(`s${index}`, 80 + (index % 20), 100));
  const open = new Set(readings.map(capacityAlertKey));
  const plan = planCapacityAlerts(readings, open);
  assert.equal(plan.candidates.length, CAPACITY_ALERT_LIMIT);
  assert.equal(plan.truncated, true);
  assert.deepEqual(plan.resolveKeys, []);
  assert.ok(plan.candidates.slice(0, 10).every((item) => item.severity === AlertSeverityDto.CRITICAL));
});
