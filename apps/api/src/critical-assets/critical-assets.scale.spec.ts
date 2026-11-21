import { parsePositiveInt, ConfirmDto, CloseCorrectionDto, NOTES_MAX_LENGTH, REFERENCE_MAX_LENGTH } from './critical-assets.controller';
import { validateSync } from 'class-validator';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BULK_CONFIRM_LIMIT, CriticalAssetsService, NO_FILTER_VALUE, pageAssets, summarizeAssets, validateReview } from './critical-assets.service';

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: 'dev', name: 'Router A', type: 'ROUTER', hostname: 'r-a', managementIp: '10.0.0.1', serialNumber: 'SN1', assetTag: 'T1',
  owner: { id: 'g1', name: 'Rede' }, dueState: 'up_to_date', latestOutcome: 'CONFIRMED', ...overrides,
}) as any;

test('pageAssets filters server-side by type, owner, outcome, due state and free text, then pages', () => {
  const rows = [
    asset({ id: 'a', name: 'Core', type: 'ROUTER', owner: { id: 'g1' }, dueState: 'overdue', latestOutcome: 'NEEDS_CORRECTION' }),
    asset({ id: 'b', name: 'Edge', type: 'SWITCH', owner: { id: 'g1' }, dueState: 'due_this_week', latestOutcome: null }),
    asset({ id: 'c', name: 'Store', type: 'STORAGE', owner: null, dueState: 'unscheduled', latestOutcome: null, serialNumber: 'XYZ-9', managementIp: '192.168.1.1' }),
  ];
  assert.deepEqual(pageAssets(rows, { owner: 'g1' }).items.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(pageAssets(rows, { owner: NO_FILTER_VALUE }).items.map((r) => r.id), ['c']);
  assert.deepEqual(pageAssets(rows, { outcome: NO_FILTER_VALUE }).items.map((r) => r.id), ['b', 'c']);
  assert.deepEqual(pageAssets(rows, { outcome: 'NEEDS_CORRECTION' }).items.map((r) => r.id), ['a']);
  assert.deepEqual(pageAssets(rows, { due: 'due_this_week', type: 'SWITCH' }).items.map((r) => r.id), ['b']);
  assert.deepEqual(pageAssets(rows, { q: 'xyz-9' }).items.map((r) => r.id), ['c']);
  assert.deepEqual(pageAssets(rows, { q: '10.0.0.1' }).items.map((r) => r.id), ['a', 'b']);
});

test('pageAssets filters by criticality tier and orders overdue first, then by name', () => {
  const rows = [
    asset({ id: 'z', name: 'Zeta', dueState: 'up_to_date', criticalityTier: 'T1' }),
    asset({ id: 'm', name: 'Mid', dueState: 'overdue', criticalityTier: 'T2' }),
    asset({ id: 'a', name: 'Alpha', dueState: 'up_to_date', criticalityTier: 'T1' }),
  ];
  assert.deepEqual(pageAssets(rows, {}).items.map((r) => r.id), ['m', 'a', 'z']);
  assert.deepEqual(pageAssets(rows, { tier: 'T1' }).items.map((r) => r.id), ['a', 'z']);
  assert.equal(pageAssets(rows, { tier: 'T1' }).total, 2);
  assert.deepEqual(pageAssets(rows, { tier: 'T3' }).items.map((r) => r.id), []);
});

test('pageAssets reports the full total and slices pages, clamping the page size', () => {
  const rows = Array.from({ length: 5 }, (_, index) => asset({ id: String(index) }));
  const second = pageAssets(rows, { page: 2, pageSize: 2 });
  assert.equal(second.total, 5);
  assert.deepEqual(second.items.map((r) => r.id), ['2', '3']);
  assert.equal(pageAssets(rows, { pageSize: 10_000 }).pageSize, 200);
  assert.equal(pageAssets(rows, { page: 0, pageSize: 0 }).pageSize, 1);
});

test('summarizeAssets counts the summary strip from the same rows', () => {
  const counts = summarizeAssets([
    { owner: { id: 'g1' }, dueState: 'overdue', latestOutcome: 'NEEDS_CORRECTION' },
    { owner: { id: 'g1' }, dueState: 'due_this_week', latestOutcome: null },
    { owner: null, dueState: 'unscheduled', latestOutcome: null },
  ]);
  assert.deepEqual(counts, { total: 3, overdue: 1, dueThisWeek: 1, needsCorrection: 1, noOwner: 1 });
});

test('validateReview: a correction request needs the data to fix, and the outcome must be in the enum', () => {
  assert.throws(() => validateReview('NEEDS_CORRECTION', '   '), BadRequestException);
  assert.throws(() => validateReview('CORRECTION_NEEDED', 'x'), BadRequestException);
  assert.deepEqual(validateReview('NOT_FOUND', ''), { outcome: 'NOT_FOUND', notes: undefined });
  assert.deepEqual(validateReview('CONFIRMED', ' ok '), { outcome: 'CONFIRMED', notes: 'ok' });
});

/** In-memory Prisma double covering what bulk review and correction close touch. */
function reviewDb(options: { members?: string[] } = {}) {
  const members = new Set(options.members ?? ['user-a']);
  const attestations: any[] = [
    { id: 'att-1', deviceId: 'd1', siteId: 's1', weekStart: new Date('2026-11-09'), outcome: null, device: { type: 'ROUTER' } },
    { id: 'att-2', deviceId: 'd2', siteId: 's1', weekStart: new Date('2026-11-09'), outcome: null, device: { type: 'ROUTER' } },
    { id: 'att-3', deviceId: 'd3', siteId: 's1', weekStart: new Date('2026-11-09'), outcome: 'CONFIRMED', device: { type: 'ROUTER' } },
    { id: 'att-4', deviceId: 'd4', siteId: 's1', weekStart: new Date('2026-11-09'), outcome: null, device: { type: 'SWITCH' } },
  ];
  const corrections: any[] = [];
  const audit: any[] = [];
  let transactions = 0;
  const writeTx = {
    criticalAssetAttestation: {
      updateMany: async ({ where, data }: any) => {
        const row = attestations.find((item) => item.id === where.id);
        if (!row || row.outcome !== where.outcome) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: any) => attestations.find((item) => item.id === where.id),
    },
    criticalAssetCorrection: {
      create: async ({ data }: any) => { corrections.push({ id: `c${corrections.length + 1}`, status: 'OPEN', ...data }); return data; },
      updateMany: async ({ where, data }: any) => {
        const row = corrections.find((item) => item.id === where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: any) => corrections.find((item) => item.id === where.id),
    },
    auditLog: { create: async ({ data }: any) => { audit.push(data); } },
  };
  const prisma: any = {
    criticalAssetAttestation: {
      findUnique: async ({ where }: any) => attestations.find((item) => item.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: any) => attestations.find((item) => item.id === where.id),
      findMany: async ({ where }: any) => attestations.filter((item) => where.id.in.includes(item.id)),
    },
    criticalAssetGroupMapping: { findUnique: async ({ where }: any) => ({ groupId: 'g1', group: { members: members.has(where.siteId_assetType.assetType === 'ROUTER' ? 'user-a' : 'nobody') ? [{ userId: 'user-a' }] : [] } }) },
    criticalAssetCorrection: {
      findUnique: async ({ where }: any) => { const row = corrections.find((item) => item.id === where.id); return row ? { ...row, device: { type: 'ROUTER' } } : null; },
      findUniqueOrThrow: async ({ where }: any) => corrections.find((item) => item.id === where.id),
    },
    accessGroupMember: { findUnique: async ({ where }: any) => (members.has(where.groupId_userId.userId) ? { groupId: 'g1', userId: where.groupId_userId.userId } : null) },
    user: { findMany: async () => [] },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => { transactions += 1; return callback(writeTx); },
  };
  const access: any = { assertSite: async () => undefined };
  return { service: new CriticalAssetsService(prisma, access), attestations, corrections, audit, transactionCount: () => transactions };
}

const reviewer = { id: 'user-a', roles: ['NETWORK_OPERATOR'] } as any;

test('bulk confirm returns a result per item and commits the good ones in one transaction', async () => {
  const db = reviewDb();
  const result = await db.service.confirmBulk([
    { id: 'att-1', outcome: 'CONFIRMED' },
    { id: 'att-2', outcome: 'NEEDS_CORRECTION', notes: 'Serial wrong' },
    { id: 'att-3', outcome: 'CONFIRMED' },
    { id: 'att-4', outcome: 'CONFIRMED' },
    { id: 'missing', outcome: 'CONFIRMED' },
    { id: 'att-1', outcome: 'CONFIRMED' },
    { id: 'att-2', outcome: 'NOT_FOUND', notes: '' },
  ], reviewer);
  assert.deepEqual(result.results.map((r: any) => [r.id, r.ok, r.code ?? r.outcome]), [
    ['att-1', true, 'CONFIRMED'],
    ['att-2', true, 'NEEDS_CORRECTION'],
    ['att-3', false, 'ALREADY_RECORDED'],
    ['att-4', false, 'FORBIDDEN'],
    ['missing', false, 'NOT_FOUND'],
    ['att-1', false, 'ALREADY_RECORDED'],
    ['att-2', false, 'ALREADY_RECORDED'],
  ]);
  assert.equal(result.recorded, 2);
  assert.equal(result.failed, 5);
  assert.equal(db.transactionCount(), 1, 'all writes share one transaction');
  assert.equal(db.corrections.length, 1);
  assert.equal(db.corrections[0].groupId, 'g1', 'the correction is owned by the reviewing group');
  assert.equal(db.audit.length, 2);
});

test('bulk confirm rejects an empty batch and a batch over the limit', async () => {
  const db = reviewDb();
  await assert.rejects(db.service.confirmBulk([], reviewer), BadRequestException);
  const tooMany = Array.from({ length: BULK_CONFIRM_LIMIT + 1 }, (_, index) => ({ id: `x${index}`, outcome: 'CONFIRMED' }));
  await assert.rejects(db.service.confirmBulk(tooMany, reviewer), BadRequestException);
});

test('a correction can only be resolved by its owning group (403 for others)', async () => {
  const db = reviewDb();
  await db.service.confirm('att-2', 'NEEDS_CORRECTION', 'Wrong serial', reviewer);
  const outsider = { id: 'user-z', roles: ['SYSTEMS_OPERATOR'] } as any;
  await assert.rejects(db.service.closeCorrection('c1', 'RESOLVED', { changeReference: 'CHG-1' }, outsider), ForbiddenException);
  assert.equal(db.corrections[0].status, 'OPEN');
});

test('resolving needs the change made, rejecting needs a reason, and a closed correction cannot be closed again', async () => {
  const db = reviewDb();
  await db.service.confirm('att-2', 'NEEDS_CORRECTION', 'Wrong serial', reviewer);
  await assert.rejects(db.service.closeCorrection('c1', 'RESOLVED', {}, reviewer), BadRequestException);
  await assert.rejects(db.service.closeCorrection('c1', 'REJECTED', { note: ' ' }, reviewer), BadRequestException);
  const resolved: any = await db.service.closeCorrection('c1', 'RESOLVED', { changeReference: 'CHG-42' }, reviewer);
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.changeReference, 'CHG-42');
  assert.equal(resolved.closedBy, 'user-a');
  await assert.rejects(db.service.closeCorrection('c1', 'REJECTED', { note: 'late' }, reviewer), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    return true;
  });
  assert.equal(db.audit.at(-1).action, 'CRITICAL_ASSET_CORRECTION_RESOLVED');
});

test('a rejected correction keeps its reason and stays in history', async () => {
  const db = reviewDb();
  await db.service.confirm('att-2', 'NEEDS_CORRECTION', 'Serial may be fine', reviewer);
  const rejected: any = await db.service.closeCorrection('c1', 'REJECTED', { note: 'Verified on the device: serial is correct' }, reviewer);
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.closeNote, 'Verified on the device: serial is correct');
  assert.equal(rejected.changeReference, null);
  assert.equal(db.corrections.length, 1);
});

test('cadence is site-scoped: a user without READ access on the Site gets 403 and no cadence is read', async () => {
  let siteReads = 0;
  const prisma: any = {
    site: {
      findUniqueOrThrow: async () => { siteReads += 1; return { criticalCadenceT1Weeks: 1, criticalCadenceT2Weeks: 2, criticalCadenceT3Weeks: 4 }; },
    },
  };
  const access: any = {
    assertSite: async (user: { id: string }, _action: string, siteId: string) => {
      if (user.id !== 'site-member' || siteId !== 'site-a') throw new ForbiddenException('no site access');
    },
  };
  const service = new CriticalAssetsService(prisma, access);
  await assert.rejects(service.cadence('site-b', { id: 'site-member', roles: ['NETWORK_OPERATOR'] } as any), ForbiddenException);
  await assert.rejects(service.cadence('site-a', { id: 'outsider', roles: ['NETWORK_OPERATOR'] } as any), ForbiddenException);
  assert.equal(siteReads, 0);
  assert.deepEqual(await service.cadence('site-a', { id: 'site-member', roles: ['NETWORK_OPERATOR'] } as any), { T1: 1, T2: 2, T3: 4 });
});

test('paging parameters must be positive whole numbers; absent is fine', () => {
  assert.equal(parsePositiveInt(undefined, 'page'), undefined);
  assert.equal(parsePositiveInt('3', 'page'), 3);
  for (const bad of ['0', '-1', 'abc', '1.5', '2e3', ' 4']) {
    assert.throws(() => parsePositiveInt(bad, 'pageSize'), BadRequestException, bad);
  }
});

test('confirm notes and correction reference/note have length limits', () => {
  const long = (n: number) => 'x'.repeat(n);
  const confirm = Object.assign(new ConfirmDto(), { outcome: 'CONFIRMED', notes: long(NOTES_MAX_LENGTH + 1) });
  assert.ok(validateSync(confirm).length > 0);
  assert.equal(validateSync(Object.assign(new ConfirmDto(), { outcome: 'CONFIRMED', notes: long(NOTES_MAX_LENGTH) })).length, 0);
  const close = Object.assign(new CloseCorrectionDto(), { changeReference: long(REFERENCE_MAX_LENGTH + 1) });
  assert.ok(validateSync(close).length > 0);
  assert.ok(validateSync(Object.assign(new CloseCorrectionDto(), { note: long(NOTES_MAX_LENGTH + 1) })).length > 0);
  assert.equal(validateSync(Object.assign(new CloseCorrectionDto(), { changeReference: 'CHG-1', note: 'ok' })).length, 0);
});

test('attestation dueAt follows the tier cadence: T2 due two weeks after opening, T3 four weeks, both Monday 09:00 Lisbon', async () => {
  const weekStart = new Date('2026-11-16T00:00:00.000Z');
  const device = (id: string, tier: string) => ({ id, name: id, type: 'SWITCH', criticalityTier: tier, criticalityTierReviewed: true, hostname: null, managementIp: null, serialNumber: null, assetTag: null, status: 'ACTIVE' });
  const attestation = (id: string, deviceId: string) => ({ id, deviceId, siteId: 'site-a', weekStart, outcome: null, notes: null, confirmedAt: null, confirmedBy: null });
  const prisma: any = {
    site: { findUniqueOrThrow: async () => ({ timezone: 'Europe/Lisbon', criticalCadenceT1Weeks: 1, criticalCadenceT2Weeks: 2, criticalCadenceT3Weeks: 4 }) },
    device: { findMany: async () => [device('dev-t2', 'T2'), device('dev-t3', 'T3')] },
    criticalAssetGroupMapping: { findMany: async () => [{ assetType: 'SWITCH', groupId: 'g1', group: { id: 'g1', name: 'Network' } }] },
    criticalAssetAttestation: { findMany: async () => [attestation('a2', 'dev-t2'), attestation('a3', 'dev-t3')] },
    user: { findMany: async () => [] },
  };
  const access: any = { assertSite: async () => undefined };
  const service = new CriticalAssetsService(prisma, access);
  const page = await service.page('site-a', {}, { id: 'admin', roles: ['ADMIN'] } as any);
  const dueOf = (name: string) => (page.items as any[]).find((item) => item.id === name).attestations[0].dueAt;
  assert.equal(dueOf('dev-t2'), '2026-11-30T09:00:00.000Z');
  assert.equal(dueOf('dev-t3'), '2026-12-14T09:00:00.000Z');
});
