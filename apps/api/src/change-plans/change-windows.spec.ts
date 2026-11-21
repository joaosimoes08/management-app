import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeOverlaps } from './change-windows';

const at = (h: number) => new Date(Date.UTC(2026, 10, 21, h));

test('flags overlapping change plans as conflicts only against active plans', () => {
  const result = computeOverlaps([
    { kind: 'CHANGE_PLAN', id: 'a', startsAt: at(8), endsAt: at(12), active: true, targetKeys: new Set(['DEVICE:1', 'VLAN:2']) },
    { kind: 'CHANGE_PLAN', id: 'b', startsAt: at(10), endsAt: at(14), active: false, targetKeys: new Set(['DEVICE:1']) },
    { kind: 'CHANGE_PLAN', id: 'c', startsAt: at(12), endsAt: at(13), active: false, targetKeys: new Set() },
    { kind: 'MAINTENANCE_WINDOW', id: 'm', startsAt: at(11), endsAt: at(20), active: true },
    { kind: 'MAINTENANCE_WINDOW', id: 'n', startsAt: at(11), endsAt: at(12), active: true },
  ]);
  const a = result.get('CHANGE_PLAN:a')!; const b = result.get('CHANGE_PLAN:b')!; const c = result.get('CHANGE_PLAN:c')!;
  // b overlaps active a → conflict; a overlaps only draft b → no conflict.
  assert.equal(b.conflict, true); assert.equal(a.conflict, false);
  assert.deepEqual(a.overlapsWith.find((item) => item.id === 'b'), { kind: 'CHANGE_PLAN', id: 'b', overlapStartsAt: at(10).toISOString(), overlapEndsAt: at(12).toISOString(), sharedTargetCount: 1 });
  // a ends at 12:00 exactly when c starts: touching, not overlapping.
  assert.equal(c.overlapsWith.some((item) => item.id === 'a'), false);
  assert.equal(c.overlapsWith.some((item) => item.id === 'b'), true);
  // c overlaps b (draft) and the maintenance window → reported but not a conflict.
  assert.equal(c.conflict, false);
  // maintenance windows are not compared with each other.
  assert.equal(result.get('MAINTENANCE_WINDOW:m')!.overlapsWith.some((item) => item.id === 'n'), false);
  assert.equal(result.get('MAINTENANCE_WINDOW:m')!.conflict, false);
});

test('returns empty overlap lists for isolated windows', () => {
  const result = computeOverlaps([{ kind: 'CHANGE_PLAN', id: 'x', startsAt: at(1), endsAt: at(2), active: true }, { kind: 'CHANGE_PLAN', id: 'y', startsAt: at(3), endsAt: at(4), active: true }]);
  assert.deepEqual(result.get('CHANGE_PLAN:x'), { overlapsWith: [], conflict: false });
});
