-- Round 2 #10/#11: discovery scans save progress per batch, can be cancelled, resume idempotently and stop at limits.
-- Additive only. CANCELLED is a terminal status, so the partial unique index "DiscoveryJob_one_active_per_subnet"
-- (PENDING, RUNNING) is unchanged and a cancelled scan frees its subnet.
ALTER TYPE "DiscoveryJobStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "DiscoveryJob"
  ADD COLUMN "totalCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "probeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxDurationSeconds" INTEGER,
  ADD COLUMN "maxProbes" INTEGER,
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "stopReason" TEXT;
