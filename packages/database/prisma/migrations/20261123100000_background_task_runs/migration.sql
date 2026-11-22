-- Round 2 #13: one row per named background task. It holds the cross-replica lease (only one run at a time) and the
-- record of the last run. Additive only.
-- CreateTable
CREATE TABLE "BackgroundTaskRun" (
    "name" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "lastSummary" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundTaskRun_pkey" PRIMARY KEY ("name")
);
