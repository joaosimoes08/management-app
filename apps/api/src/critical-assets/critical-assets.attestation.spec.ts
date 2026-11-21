import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { ATTESTATION_OPENS_AT_HOUR, computeDueState, cycleWindow, CriticalAssetsService, weeklyWindow } from './critical-assets.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const pending = (weekStart: string) => ({ weekStart: day(weekStart), outcome: null });
const recorded = (weekStart: string, outcome = 'CONFIRMED') => ({ weekStart: day(weekStart), outcome });

test('a cycle opens Monday 09:00 Site-local and is due the following Monday 09:00', () => {
  const lisbon = cycleWindow(day('2026-11-09'), 'Europe/Lisbon');
  assert.equal(lisbon.opensAt.toISOString(), '2026-11-09T09:00:00.000Z');
  assert.equal(lisbon.dueAt.toISOString(), '2026-11-16T09:00:00.000Z');
  const newYork = cycleWindow(day('2026-11-09'), 'America/New_York');
  assert.equal(newYork.dueAt.toISOString(), '2026-11-16T14:00:00.000Z');
});

test('due time follows daylight saving changes inside the cycle', () => {
  // Lisbon leaves summer time on 2026-10-25: opens 08:00Z (UTC+1), due 09:00Z (UTC+0).
  const autumn = cycleWindow(day('2026-10-19'), 'Europe/Lisbon');
  assert.equal(autumn.opensAt.toISOString(), '2026-10-19T08:00:00.000Z');
  assert.equal(autumn.dueAt.toISOString(), '2026-10-26T09:00:00.000Z');
  // Lisbon enters summer time on 2026-03-29: opens 09:00Z, due 08:00Z.
  const spring = cycleWindow(day('2026-03-23'), 'Europe/Lisbon');
  assert.equal(spring.opensAt.toISOString(), '2026-03-23T09:00:00.000Z');
  assert.equal(spring.dueAt.toISOString(), '2026-03-30T08:00:00.000Z');
});

test('pending current cycle is due_this_week until the exact due instant, then overdue', () => {
  const rows = [pending('2026-11-09'), recorded('2026-11-02')];
  const before = computeDueState(rows, true, 'Europe/Lisbon', new Date('2026-11-16T08:59:59.999Z'));
  assert.equal(before.dueState, 'due_this_week');
  assert.equal(before.dueDate, '2026-11-16T09:00:00.000Z');
  assert.equal(before.dueWeekStart, '2026-11-09');
  const at = computeDueState(rows, true, 'Europe/Lisbon', new Date('2026-11-16T09:00:00.000Z'));
  assert.equal(at.dueState, 'overdue');
  assert.equal(at.dueDate, '2026-11-16T09:00:00.000Z');
  assert.equal(at.overdueCount, 1);
});

test('overdue reports the oldest overdue cycle and counts every pending one', () => {
  const rows = [pending('2026-11-16'), pending('2026-11-09'), pending('2026-11-02')];
  const result = computeDueState(rows, true, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z'));
  assert.equal(result.dueState, 'overdue');
  assert.equal(result.dueWeekStart, '2026-11-02');
  assert.equal(result.dueDate, '2026-11-09T09:00:00.000Z');
  assert.equal(result.pendingCount, 3);
  assert.equal(result.overdueCount, 2);
});

test('Site timezone decides the week when UTC is still on the previous day', () => {
  // 2026-11-15T23:30Z is Monday 08:30 in Tokyo; the 2026-11-09 cycle was due Monday 09:00 JST = 00:00Z.
  const rows = [pending('2026-11-09')];
  assert.equal(computeDueState(rows, true, 'Asia/Tokyo', new Date('2026-11-15T23:59:59.000Z')).dueState, 'due_this_week');
  const tokyo = computeDueState(rows, true, 'Asia/Tokyo', new Date('2026-11-16T00:00:00.000Z'));
  assert.equal(tokyo.dueState, 'overdue');
  assert.equal(tokyo.dueDate, '2026-11-16T00:00:00.000Z');
  // Same instant in Lisbon: still Monday 00:00 local, so not due yet.
  assert.equal(computeDueState(rows, true, 'Europe/Lisbon', new Date('2026-11-16T00:00:00.000Z')).dueState, 'due_this_week');
});

test('up_to_date points at the next cycle to be generated', () => {
  // Current cycle already recorded: next is next week's, due the Monday after.
  const done = computeDueState([recorded('2026-11-16'), recorded('2026-11-09')], true, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z'));
  assert.deepEqual({ state: done.dueState, week: done.dueWeekStart, due: done.dueDate }, { state: 'up_to_date', week: '2026-11-23', due: '2026-11-30T09:00:00.000Z' });
  // Monday 08:00, before this week's cycle opens: next is this week's.
  const early = computeDueState([recorded('2026-11-09')], true, 'Europe/Lisbon', new Date('2026-11-16T08:00:00.000Z'));
  assert.deepEqual({ state: early.dueState, week: early.dueWeekStart, due: early.dueDate }, { state: 'up_to_date', week: '2026-11-16', due: '2026-11-23T09:00:00.000Z' });
  // Wednesday with this week's cycle never generated (the scheduler only generates on Monday): next is next week's.
  const missed = computeDueState([recorded('2026-11-09')], true, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z'));
  assert.equal(missed.dueWeekStart, '2026-11-23');
});

test('an unowned asset with pending cycles is unscheduled, not overdue, but keeps its counts', () => {
  // Rows can outlive a removed group mapping; nobody can review them, so they belong under "no owner".
  const rows = [pending('2026-11-16'), pending('2026-11-02'), recorded('2026-10-26')];
  const result = computeDueState(rows, false, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z'));
  assert.deepEqual(result, { pendingCount: 2, overdueCount: 1, dueState: 'unscheduled', dueDate: null, dueWeekStart: null });
  assert.equal(computeDueState(rows, true, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z')).dueState, 'overdue');
});

test('weekly generation opens at ATTESTATION_OPENS_AT_HOUR Site-local', () => {
  assert.equal(ATTESTATION_OPENS_AT_HOUR, 9);
  assert.equal(weeklyWindow(new Date('2026-11-16T08:59:00.000Z'), 'Europe/Lisbon').due, false);
  assert.equal(weeklyWindow(new Date('2026-11-16T09:00:00.000Z'), 'Europe/Lisbon').due, true);
  assert.equal(weeklyWindow(new Date('2026-11-16T13:59:00.000Z'), 'America/New_York').due, false);
  assert.equal(weeklyWindow(new Date('2026-11-16T14:00:00.000Z'), 'America/New_York').due, true);
});

test('unscheduled when there is no owner group or no cycle yet', () => {
  const unowned = computeDueState([], false, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z'));
  assert.deepEqual({ state: unowned.dueState, due: unowned.dueDate, week: unowned.dueWeekStart }, { state: 'unscheduled', due: null, week: null });
  const ownedNoRows = computeDueState([], true, 'Europe/Lisbon', new Date('2026-11-18T12:00:00.000Z'));
  assert.deepEqual({ state: ownedNoRows.dueState, due: ownedNoRows.dueDate, week: ownedNoRows.dueWeekStart }, { state: 'unscheduled', due: '2026-11-30T09:00:00.000Z', week: '2026-11-23' });
});

const reviewer = { id: 'user-a', username: 'ana.ops', displayName: 'Ana Operações' };
const noDisplayName = { id: 'user-b', username: 'bruno.ops', displayName: null };

function confirmService(row: Record<string, unknown>, options: { raceLost?: boolean } = {}) {
  let stored: Record<string, unknown> = { ...row };
  const audit: unknown[] = [];
  const users = [reviewer, noDisplayName];
  const attestationApi = {
    findUnique: async () => ({ ...stored, device: { type: 'ROUTER' } }),
    findUniqueOrThrow: async () => ({ ...stored }),
  };
  const prisma: any = {
    criticalAssetAttestation: attestationApi,
    criticalAssetGroupMapping: { findUnique: async () => ({ group: { members: [] } }) },
    user: { findMany: async ({ where }: any) => users.filter((user) => where.id.in.includes(user.id)) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      criticalAssetAttestation: {
        ...attestationApi,
        updateMany: async ({ where, data }: any) => {
          if (options.raceLost) { stored = { ...stored, outcome: 'CONFIRMED', confirmedBy: 'user-a', confirmedAt: new Date('2026-11-10T10:00:00.000Z') }; return { count: 0 }; }
          if (where.outcome !== null || stored.outcome) return { count: 0 };
          stored = { ...stored, ...data };
          return { count: 1 };
        },
      },
      auditLog: { create: async (entry: unknown) => { audit.push(entry); } },
    }),
  };
  const access: any = { assertSite: async () => undefined };
  return { service: new CriticalAssetsService(prisma, access), audit, stored: () => stored };
}

const pendingRow = { id: 'att-1', deviceId: 'device-a', siteId: 'site-a', weekStart: day('2026-11-09'), outcome: null, notes: null, confirmedAt: null, confirmedBy: null, createdAt: day('2026-11-09') };

test('confirm records a pending cycle and returns the reviewer name', async () => {
  const { service, audit } = confirmService(pendingRow);
  const result: any = await service.confirm('att-1', 'CORRECTION_NEEDED', 'Serial number is wrong', { id: 'user-b', roles: ['ADMIN'] } as any);
  assert.equal(result.outcome, 'CORRECTION_NEEDED');
  assert.equal(result.notes, 'Serial number is wrong');
  assert.equal(result.confirmedBy, 'user-b');
  assert.equal(result.confirmedByName, 'bruno.ops', 'falls back to username without a display name');
  assert.deepEqual(result.confirmedByUser, { id: 'user-b', username: 'bruno.ops', displayName: null });
  assert.equal(result.inventoryChanged, false);
  assert.equal(audit.length, 1);
});

test('confirming an already recorded cycle returns 409 and does not overwrite it', async () => {
  const done = { ...pendingRow, outcome: 'CONFIRMED', confirmedBy: 'user-a', confirmedAt: new Date('2026-11-10T10:00:00.000Z') };
  const { service, audit, stored } = confirmService(done);
  await assert.rejects(service.confirm('att-1', 'CORRECTION_NEEDED', 'late', { id: 'user-b', roles: ['ADMIN'] } as any), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.getStatus(), 409);
    const body = error.getResponse() as Record<string, unknown>;
    assert.equal(body.code, 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED');
    const details = body.details as Record<string, unknown>;
    assert.equal(details.confirmedByName, 'Ana Operações');
    assert.equal(details.weekStart, '2026-11-09');
    assert.equal(details.outcome, 'CONFIRMED');
    assert.match(String(body.message), /já foi registada por Ana Operações/);
    return true;
  });
  assert.equal(stored().outcome, 'CONFIRMED');
  assert.equal(audit.length, 0);
});

test('a concurrent review that loses the race gets 409 instead of overwriting', async () => {
  const { service, audit } = confirmService(pendingRow, { raceLost: true });
  await assert.rejects(service.confirm('att-1', 'CONFIRMED', undefined, { id: 'user-b', roles: ['ADMIN'] } as any), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(((error.getResponse() as any).details).confirmedByName, 'Ana Operações');
    return true;
  });
  assert.equal(audit.length, 0);
});

test('list returns full history with reviewer names, notes, owner and due state', async () => {
  const group = { id: 'group-a', name: 'Network team' };
  const weeks = ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12'];
  const rows = weeks.map((week, index) => ({ id: `att-${index}`, deviceId: 'device-a', siteId: 'site-a', weekStart: day(week), outcome: index === 0 ? null : 'CONFIRMED', notes: index === 2 ? 'checked serial' : null, confirmedAt: index === 0 ? null : day(week), confirmedBy: index === 0 ? null : index === 1 ? 'user-b' : 'user-a', createdAt: day(week) }));
  const prisma: any = {
    site: { findUniqueOrThrow: async () => ({ timezone: 'Europe/Lisbon' }) },
    device: { findMany: async () => [
      { id: 'device-a', name: 'Router A', type: 'ROUTER', hostname: 'r-a', managementIp: '10.0.0.1', serialNumber: 'S1', assetTag: 'T1', status: 'ACTIVE' },
      { id: 'device-b', name: 'Storage B', type: 'STORAGE', hostname: null, managementIp: null, serialNumber: null, assetTag: null, status: 'ACTIVE' },
    ] },
    criticalAssetGroupMapping: { findMany: async () => [{ id: 'map-a', siteId: 'site-a', assetType: 'ROUTER', groupId: group.id, group }] },
    criticalAssetAttestation: { findMany: async () => rows },
    user: { findMany: async () => [reviewer, noDisplayName] },
  };
  const access: any = { assertSite: async () => undefined };
  const result: any = await new CriticalAssetsService(prisma, access).list('site-a', { id: 'admin', roles: ['ADMIN'] } as any);
  const router = result.assets.find((asset: any) => asset.id === 'device-a');
  assert.equal(router.attestations.length, 6, 'history is not capped');
  assert.deepEqual(router.owner, group);
  assert.deepEqual(router.assignedGroup, group);
  assert.ok(['due_this_week', 'overdue'].includes(router.dueState));
  assert.equal(router.dueWeekStart, '2026-11-16');
  assert.equal(router.latestOutcome, 'CONFIRMED');
  assert.equal(router.attestations[0].confirmedByName, null);
  assert.equal(router.attestations[1].confirmedByName, 'bruno.ops');
  assert.equal(router.attestations[2].confirmedByName, 'Ana Operações');
  assert.equal(router.attestations[2].notes, 'checked serial');
  const storage = result.assets.find((asset: any) => asset.id === 'device-b');
  assert.equal(storage.owner, null);
  assert.equal(storage.dueState, 'unscheduled');
  assert.equal(storage.dueDate, null);
  assert.deepEqual(result.unassigned.map((asset: any) => [asset.id, asset.owner, asset.dueState]), [['device-b', null, 'unscheduled']]);
});
