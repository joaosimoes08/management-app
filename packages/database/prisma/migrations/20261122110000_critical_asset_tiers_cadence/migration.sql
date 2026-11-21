-- Step 28b: criticality tiers replace the boolean isCritical as the source of truth.
-- isCritical stays in sync (true for T1 and T2 and T3 devices) for existing readers.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CriticalityTier') THEN
    RAISE EXCEPTION 'CriticalityTier already exists';
  END IF;
END $$;

CREATE TYPE "CriticalityTier" AS ENUM ('T1', 'T2', 'T3');

ALTER TABLE "Device"
  ADD COLUMN "criticalityTier" "CriticalityTier",
  ADD COLUMN "criticalityTierReviewed" BOOLEAN NOT NULL DEFAULT false;

-- Migrated devices: every existing critical device becomes T1 (vital), unreviewed, so its review cadence does not change.
UPDATE "Device" SET "criticalityTier" = 'T1' WHERE "isCritical" = true;

ALTER TABLE "Site"
  ADD COLUMN "criticalCadenceT1Weeks" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "criticalCadenceT2Weeks" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "criticalCadenceT3Weeks" INTEGER NOT NULL DEFAULT 4;
