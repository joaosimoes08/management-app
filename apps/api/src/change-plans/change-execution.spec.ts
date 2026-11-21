import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkItem, closingNoteError, detectTierField, isTierOne, summarizeCheck, transitionError, uncoveredIntervals } from './change-execution';

const at = (h: number) => new Date(Date.UTC(2026, 10, 21, h));

test('only APPROVED plans can start and only IN_PROGRESS plans can close', () => {
  for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK']) assert.equal(transitionError(status, 'START')?.code, 'CHANGE_PLAN_NOT_STARTABLE', status);
  assert.equal(transitionError('APPROVED', 'START'), null);
  for (const status of ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'FAILED', 'ROLLED_BACK']) assert.equal(transitionError(status, 'CLOSE')?.code, 'CHANGE_PLAN_NOT_CLOSABLE', status);
  assert.equal(transitionError('IN_PROGRESS', 'CLOSE'), null);
});

test('checklist is ticked only in progress and locked once closed', () => {
  assert.equal(transitionError('APPROVED', 'CHECKLIST_TICK')?.code, 'CHANGE_PLAN_NOT_IN_PROGRESS');
  assert.equal(transitionError('IN_PROGRESS', 'CHECKLIST_TICK'), null);
  assert.equal(transitionError('DRAFT', 'CHECKLIST_EDIT'), null);
  for (const status of ['COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED']) assert.equal(transitionError(status, 'CHECKLIST_EDIT')?.code, 'CHANGE_PLAN_CHECKLIST_LOCKED');
  assert.equal(transitionError('DRAFT', 'LINK_SNMP')?.code, 'CHANGE_PLAN_NOT_LINKABLE');
  assert.equal(transitionError('IN_PROGRESS', 'LINK_SNMP'), null);
});

test('failed and rolled-back closes need a note; completed does not', () => {
  assert.equal(closingNoteError('COMPLETED', ''), null);
  assert.equal(closingNoteError('FAILED', '  ')?.code, 'CHANGE_CLOSING_NOTE_REQUIRED');
  assert.equal(closingNoteError('ROLLED_BACK', undefined)?.code, 'CHANGE_CLOSING_NOTE_REQUIRED');
  assert.equal(closingNoteError('ROLLED_BACK', 'Reverti a VLAN'), null);
});

test('post-change check reports AS_PLANNED when current data matches the plan', () => {
  const item = { entityType: 'VLAN', entityId: 'v1', operationSummary: 'Renomear VLAN', currentValue: { name: 'old', vlanId: 24 }, proposedValue: { name: 'Servers', vlanId: '24' } };
  const result = checkItem(item, { id: 'v1', name: 'Servers ', vlanId: 24, description: 'x' });
  assert.equal(result.result, 'AS_PLANNED');
  assert.deepEqual(result.fields.map((f) => [f.field, f.matches]), [['name', true], ['vlanId', true]]);
});

test('post-change check flags a deliberately changed field as DIFFERENT', () => {
  const items = [
    checkItem({ entityType: 'IP_ADDRESS', entityId: 'ip1', operationSummary: 'Reservar IP', proposedValue: { address: '10.0.0.5', state: 'RESERVED' } }, { address: '10.0.0.5', state: 'OCCUPIED' }),
    checkItem({ entityType: 'DEVICE', entityId: 'd1', operationSummary: 'Renomear', proposedValue: { hostname: 'SW-01' } }, { hostname: 'sw-01' }),
  ];
  assert.equal(items[0].result, 'DIFFERENT');
  assert.deepEqual(items[0].fields.find((f) => f.field === 'state'), { field: 'state', planned: 'RESERVED', current: 'OCCUPIED', before: null, matches: false });
  assert.equal(items[1].result, 'AS_PLANNED');
  const summary = summarizeCheck(items);
  assert.equal(summary.result, 'DIFFERENT');
  assert.deepEqual(summary.counts, { AS_PLANNED: 1, DIFFERENT: 1, NOT_COMPARABLE: 0, TARGET_MISSING: 0 });
});

test('post-change check handles missing targets, unknown fields and items without proposed values', () => {
  assert.equal(checkItem({ entityType: 'VLAN', entityId: 'gone', operationSummary: 'x', proposedValue: { name: 'a' } }, null).result, 'TARGET_MISSING');
  assert.equal(checkItem({ entityType: 'VLAN', entityId: 'v', operationSummary: 'x' }, { name: 'a' }).result, 'NOT_COMPARABLE');
  assert.equal(checkItem({ entityType: 'VLAN', entityId: 'v', operationSummary: 'x', proposedValue: { colour: 'red' } }, { name: 'a' }).result, 'DIFFERENT');
  assert.equal(summarizeCheck([checkItem({ entityType: 'VLAN', entityId: 'v', operationSummary: 'x' }, { name: 'a' })]).result, 'NOT_COMPARABLE');
  assert.equal(summarizeCheck([checkItem({ entityType: 'VLAN', entityId: 'v', operationSummary: 'x', proposedValue: { name: 'a' } }, null)]).result, 'DIFFERENT');
});

test('uncovered intervals: fully covered, partially covered and no windows', () => {
  assert.deepEqual(uncoveredIntervals(at(10), at(12), [{ startsAt: at(9), endsAt: at(11) }, { startsAt: at(11), endsAt: at(13) }]), []);
  assert.deepEqual(uncoveredIntervals(at(10), at(14), [{ startsAt: at(11), endsAt: at(12) }]), [{ startsAt: at(10).toISOString(), endsAt: at(11).toISOString() }, { startsAt: at(12).toISOString(), endsAt: at(14).toISOString() }]);
  assert.deepEqual(uncoveredIntervals(at(10), at(11), []), [{ startsAt: at(10).toISOString(), endsAt: at(11).toISOString() }]);
  // a window that only touches the end does not cover anything
  assert.deepEqual(uncoveredIntervals(at(10), at(11), [{ startsAt: at(11), endsAt: at(12) }]), [{ startsAt: at(10).toISOString(), endsAt: at(11).toISOString() }]);
});

test('tier feature detection works before and after Step 28b', () => {
  assert.equal(detectTierField(['id', 'name', 'isCritical']), null);
  assert.equal(detectTierField(['id', 'criticalityTier']), 'criticalityTier');
  assert.equal(isTierOne('TIER_1'), true); assert.equal(isTierOne(1), true); assert.equal(isTierOne('TIER_2'), false); assert.equal(isTierOne(null), false);
});
