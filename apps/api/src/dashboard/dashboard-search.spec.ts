import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { interleaveByType, LEGACY_SEARCH_TYPES, parseSearchTypes, SEARCH_TYPES } from './dashboard.service';

test('search types: absent keeps the original nine, all or a list is explicit', () => {
  assert.deepEqual(parseSearchTypes(undefined), { types: [...LEGACY_SEARCH_TYPES], explicit: false });
  assert.deepEqual(parseSearchTypes('all'), { types: [...SEARCH_TYPES], explicit: true });
  assert.deepEqual(parseSearchTypes('change_plan, AUDIT_EVENT'), { types: ['CHANGE_PLAN', 'AUDIT_EVENT'], explicit: true });
  assert.throws(() => parseSearchTypes('PEOPLE'));
});

test('interleaving shares a small limit fairly between types', () => {
  const items = [
    ...Array.from({ length: 5 }, (_, index) => ({ type: 'DEVICE', id: `d${index}` })),
    { type: 'CHANGE_PLAN', id: 'c0' },
    { type: 'AUDIT_EVENT', id: 'a0' }, { type: 'AUDIT_EVENT', id: 'a1' },
  ];
  assert.deepEqual(interleaveByType(items, ['DEVICE', 'CHANGE_PLAN', 'AUDIT_EVENT'], 5).map((item) => item.id), ['d0', 'c0', 'a0', 'd1', 'a1']);
});
