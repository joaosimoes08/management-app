-- Manual reversal (Prisma does not run it).
ALTER TABLE "Site"
  DROP COLUMN "criticalCadenceT3Weeks",
  DROP COLUMN "criticalCadenceT2Weeks",
  DROP COLUMN "criticalCadenceT1Weeks";
ALTER TABLE "Device"
  DROP COLUMN "criticalityTierReviewed",
  DROP COLUMN "criticalityTier";
DROP TYPE "CriticalityTier";
