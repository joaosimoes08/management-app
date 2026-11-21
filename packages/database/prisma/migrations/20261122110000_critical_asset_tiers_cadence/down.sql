-- Manual reversal (Prisma does not run it). Tiers and cadence columns only; isCritical was never changed by the migration.
ALTER TABLE "Site"
  DROP COLUMN "criticalCadenceT3Weeks",
  DROP COLUMN "criticalCadenceT2Weeks",
  DROP COLUMN "criticalCadenceT1Weeks";
ALTER TABLE "Device"
  DROP COLUMN "criticalityTierReviewed",
  DROP COLUMN "criticalityTier";
DROP TYPE "CriticalityTier";
