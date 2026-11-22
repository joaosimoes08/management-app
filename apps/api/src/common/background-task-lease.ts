import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Prisma, PrismaClient } from '@simoes/database';

/**
 * Round 2 #13: a lease in PostgreSQL (`BackgroundTaskRun`) so a periodic task runs at most once at a time across every
 * API replica, and at most once per `minIntervalMs`. The row also keeps the record of the last run.
 *
 * - The lease is taken with one atomic `INSERT … ON CONFLICT DO UPDATE … WHERE`: only one caller gets a row back.
 * - `ttlMs` bounds a crashed holder: once `leaseUntil` passes, another replica may take the task again.
 * - Release clears the lease only if this caller still holds it (an expired and re-taken lease is left alone).
 */
export type TaskRunOutcome<T> = { ran: true; result: T } | { ran: false; reason: 'LEASE_HELD' | 'TOO_SOON' | 'IN_PROCESS' | 'FAILED' };

const processOwner = `${hostname()}:${process.pid}`;

export async function tryAcquireTaskLease(prisma: PrismaClient, name: string, options: { ttlMs: number; minIntervalMs?: number; owner?: string; now?: Date }) {
  const now = options.now ?? new Date();
  const owner = options.owner ?? `${processOwner}:${randomUUID()}`;
  const leaseUntil = new Date(now.getTime() + options.ttlMs);
  const startedBefore = new Date(now.getTime() - (options.minIntervalMs ?? 0));
  const rows = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    INSERT INTO "BackgroundTaskRun" ("name", "leaseOwner", "leaseUntil", "lastStartedAt", "lastStatus", "updatedAt")
    VALUES (${name}, ${owner}, ${leaseUntil}, ${now}, 'RUNNING', ${now})
    ON CONFLICT ("name") DO UPDATE
      SET "leaseOwner" = EXCLUDED."leaseOwner", "leaseUntil" = EXCLUDED."leaseUntil", "lastStartedAt" = EXCLUDED."lastStartedAt",
          "lastStatus" = 'RUNNING', "updatedAt" = EXCLUDED."updatedAt"
      WHERE ("BackgroundTaskRun"."leaseUntil" IS NULL OR "BackgroundTaskRun"."leaseUntil" <= ${now})
        AND ("BackgroundTaskRun"."lastStartedAt" IS NULL OR "BackgroundTaskRun"."lastStartedAt" <= ${startedBefore})
    RETURNING "name"`);
  return rows.length ? owner : null;
}

export async function releaseTaskLease(prisma: PrismaClient, name: string, owner: string, outcome: { status: 'COMPLETED' | 'FAILED'; startedAt: Date; error?: string | null; summary?: unknown; now?: Date }) {
  const now = outcome.now ?? new Date();
  await prisma.backgroundTaskRun.updateMany({
    where: { name, leaseOwner: owner },
    data: {
      leaseOwner: null, leaseUntil: null, lastFinishedAt: now, lastStatus: outcome.status,
      lastError: outcome.error ? outcome.error.slice(0, 500) : null,
      lastDurationMs: Math.max(0, now.getTime() - outcome.startedAt.getTime()),
      lastSummary: outcome.summary === undefined ? Prisma.DbNull : (outcome.summary as Prisma.InputJsonValue),
    },
  });
}

/** Runs `task` only if this caller takes the lease; always releases it and records the outcome. */
export async function runWithTaskLease<T>(prisma: PrismaClient, name: string, options: { ttlMs: number; minIntervalMs?: number; now?: Date }, task: () => Promise<T>, summarize?: (result: T) => unknown): Promise<TaskRunOutcome<T>> {
  const startedAt = options.now ?? new Date();
  const owner = await tryAcquireTaskLease(prisma, name, { ...options, now: startedAt });
  if (!owner) {
    const row = await prisma.backgroundTaskRun.findUnique({ where: { name }, select: { leaseUntil: true } });
    return { ran: false, reason: row?.leaseUntil && row.leaseUntil > startedAt ? 'LEASE_HELD' : 'TOO_SOON' };
  }
  try {
    const result = await task();
    await releaseTaskLease(prisma, name, owner, { status: 'COMPLETED', startedAt, summary: summarize?.(result) });
    return { ran: true, result };
  } catch (error) {
    await releaseTaskLease(prisma, name, owner, { status: 'FAILED', startedAt, error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  }
}
