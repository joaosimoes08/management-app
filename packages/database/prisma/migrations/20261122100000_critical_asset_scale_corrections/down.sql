-- Manual reversal for 20261122100000 (Prisma does not run this file). Test on a DB copy first.
DROP TABLE IF EXISTS "CriticalAssetCorrection";
DROP TYPE IF EXISTS "CriticalAssetCorrectionStatus";
ALTER TABLE "CriticalAssetAttestation" ALTER COLUMN "outcome" TYPE TEXT USING "outcome"::TEXT;
UPDATE "CriticalAssetAttestation" SET "outcome" = 'CORRECTION_NEEDED' WHERE "outcome" = 'NEEDS_CORRECTION';
UPDATE "CriticalAssetAttestation" SET "outcome" = 'CONFIRMED' WHERE "outcome" = 'NOT_FOUND';
DROP TYPE IF EXISTS "CriticalAssetOutcome";
