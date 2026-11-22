import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@simoes/database';
import { runWithTaskLease, tryAcquireTaskLease } from '../src/common/background-task-lease';
import { CRITICAL_ASSET_SWEEP_TASK, CriticalAssetsService } from '../src/critical-assets/critical-assets.service';

// Round 2 #13: the critical-asset sweep runs once at a time across replicas and only touches assets that still need a cycle.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const siteId = 'c1300000-0000-4000-8000-000000000001';
const groupId = 'c1300000-0000-4000-8000-000000000002';
const userId = 'c1300000-0000-4000-8000-000000000003';
const mondayAfterNine = new Date('2026-11-09T10:00:00.000Z');
const tasks = ['r2-13-lease-a', 'r2-13-lease-b', 'r2-13-lease-c', 'r2-13-lease-d'];

async function cleanup() {
  await prisma.backgroundTaskRun.deleteMany({ where: { name: { in: [...tasks, CRITICAL_ASSET_SWEEP_TASK] } } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
  await prisma.accessGroup.deleteMany({ where: { id: groupId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

before(async () => {
  await cleanup();
  await prisma.user.create({ data: { id: userId, externalId: 'r2-13-sweep-user', username: 'r2-13-sweep', email: 'r2-13-sweep@example.test' } });
  await prisma.site.create({ data: { id: siteId, name: 'R2-13 Sweep Site', code: 'R2-13-SWEEP' } });
  await prisma.accessGroup.create({ data: { id: groupId, name: 'R2-13 sweep reviewers', members: { create: [{ userId }] } } });
  await prisma.criticalAssetGroupMapping.create({ data: { siteId, assetType: 'ROUTER', groupId } });
  await prisma.device.createMany({ data: [
    ...Array.from({ length: 5 }, (_, index) => ({ name: `R2-13 router ${index}`, type: 'ROUTER' as const, siteId, isCritical: true, criticalityTier: 'T1' as const })),
    // No reviewer group for SERVER on this Site: never a candidate, so never re-read every minute.
    ...Array.from({ length: 3 }, (_, index) => ({ name: `R2-13 server ${index}`, type: 'SERVER' as const, siteId, isCritical: true, criticalityTier: 'T1' as const })),
  ] });
});
after(async () => { await cleanup(); await prisma.$disconnect(); });

test('only one of two concurrent callers takes the lease, and the run is recorded', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = runWithTaskLease(prisma, tasks[0], { ttlMs: 60_000 }, async () => { runs += 1; await gate; return { done: true }; }, (result) => result);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await runWithTaskLease(prisma, tasks[0], { ttlMs: 60_000 }, async () => { runs += 1; return { done: true }; });
  assert.deepEqual(second, { ran: false, reason: 'LEASE_HELD' });
  release();
  assert.equal((await first).ran, true);
  assert.equal(runs, 1);
  const row = await prisma.backgroundTaskRun.findUniqueOrThrow({ where: { name: tasks[0] } });
  assert.equal(row.lastStatus, 'COMPLETED');
  assert.equal(row.leaseOwner, null);
  assert.equal(row.leaseUntil, null);
  assert.ok(row.lastFinishedAt && row.lastDurationMs !== null);
  assert.deepEqual(row.lastSummary, { done: true });
});

test('many racing replicas: exactly one acquires', async () => {
  const owners = await Promise.all(Array.from({ length: 8 }, () => tryAcquireTaskLease(prisma, tasks[1], { ttlMs: 60_000 })));
  assert.equal(owners.filter(Boolean).length, 1);
});

test('minimum gap: a second run in the same minute is skipped, a later one runs', async () => {
  const start = new Date('2026-11-09T10:00:00.000Z');
  assert.equal((await runWithTaskLease(prisma, tasks[2], { ttlMs: 60_000, minIntervalMs: 50_000, now: start }, async () => 1)).ran, true);
  assert.deepEqual(await runWithTaskLease(prisma, tasks[2], { ttlMs: 60_000, minIntervalMs: 50_000, now: new Date(start.getTime() + 20_000) }, async () => 1), { ran: false, reason: 'TOO_SOON' });
  assert.equal((await runWithTaskLease(prisma, tasks[2], { ttlMs: 60_000, minIntervalMs: 50_000, now: new Date(start.getTime() + 60_000) }, async () => 1)).ran, true);
});

test('an expired lease from a crashed holder is taken over, and a failed run is recorded and released', async () => {
  const crashedAt = new Date(Date.now() - 120_000);
  assert.ok(await tryAcquireTaskLease(prisma, tasks[3], { ttlMs: 60_000, now: crashedAt }));
  await assert.rejects(runWithTaskLease(prisma, tasks[3], { ttlMs: 60_000 }, async () => { throw new Error('injected sweep failure'); }), /injected sweep failure/);
  const row = await prisma.backgroundTaskRun.findUniqueOrThrow({ where: { name: tasks[3] } });
  assert.equal(row.lastStatus, 'FAILED');
  assert.equal(row.lastError, 'injected sweep failure');
  assert.equal(row.leaseOwner, null);
});

/**
 * The sweep is global: it also opens cycles for critical assets that other suites (http.integration) left in the same
 * _test database. Those cycles are not this test's, so the assertions count only this Site's rows, and the foreign
 * cycles the sweep opened (with their notifications and queued deliveries) are removed again afterwards.
 */
async function removeForeignCycles(foreign: { id: string; deviceId: string; weekStart: Date }[]) {
  if (!foreign.length) return;
  const links = foreign.map(({ deviceId, weekStart }) => ({ AND: [{ contains: `assetId=${deviceId}` }, { contains: `week=${weekStart.toISOString().slice(0, 10)}` }] }));
  await prisma.notification.deleteMany({ where: { type: 'CRITICAL_ASSET_ATTESTATION', OR: links.map(({ AND }) => ({ AND: AND.map((filter) => ({ sourceHref: filter })) })) } });
  await prisma.notificationDelivery.deleteMany({ where: { topic: 'CRITICAL_ASSET_ATTESTATION', OR: links.map(({ AND }) => ({ AND: AND.map((filter) => ({ href: filter })) })) } });
  await prisma.criticalAssetAttestation.deleteMany({ where: { id: { in: foreign.map(({ id }) => id) } } });
}

test('critical-asset sweep: two replicas at the same minute run it once; later minutes find nothing to do', async () => {
  const existing = new Set((await prisma.criticalAssetAttestation.findMany({ select: { id: true } })).map(({ id }) => id));
  const foreignCycles = async () => (await prisma.criticalAssetAttestation.findMany({ where: { siteId: { not: siteId } }, select: { id: true, deviceId: true, weekStart: true } })).filter(({ id }) => !existing.has(id));
  const replicaA = new CriticalAssetsService(prisma, {} as never);
  const replicaB = new CriticalAssetsService(prisma, {} as never);
  try {
    const [a, b] = await Promise.all([replicaA.runScheduledSweep(mondayAfterNine), replicaB.runScheduledSweep(mondayAfterNine)]);
    const ran = [a, b].filter((outcome) => outcome.ran);
    assert.equal(ran.length, 1);
    const summary = (ran[0] as { ran: true; result: { created: number; candidates: number } }).result;
    // Exactly this Site's 5 routers, plus whatever other Sites' assets the same sweep opened (0 on an empty database).
    assert.equal(summary.created, 5 + (await foreignCycles()).length);
    assert.equal(await prisma.criticalAssetAttestation.count({ where: { siteId } }), 5);
    assert.equal(await prisma.notification.count({ where: { userId, type: 'CRITICAL_ASSET_ATTESTATION' } }), 5);

    // Same process, overlapping ticks: the second is refused before touching the database.
    const [first, overlap] = await Promise.all([replicaA.runScheduledSweep(new Date(mondayAfterNine.getTime() + 60_000)), replicaA.runScheduledSweep(new Date(mondayAfterNine.getTime() + 60_000))]);
    assert.deepEqual(overlap, { ran: false, reason: 'IN_PROCESS' });
    assert.equal(first.ran, true);
    // Steady state: the week's cycles exist, so the set-based query returns no candidates and nothing is written.
    assert.deepEqual((first as { ran: true; result: unknown }).result, { sitesDue: (first as any).result.sitesDue, candidates: 0, created: 0, failed: 0 });
    assert.equal(await prisma.notification.count({ where: { userId } }), 5);
    const record = await prisma.backgroundTaskRun.findUniqueOrThrow({ where: { name: CRITICAL_ASSET_SWEEP_TASK } });
    assert.equal(record.lastStatus, 'COMPLETED');
  } finally {
    await removeForeignCycles(await foreignCycles());
  }
});
