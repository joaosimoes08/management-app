-- Step 28a: outcome enum, correction requests.
-- 1. Refuse to run if an unexpected outcome text exists (only CONFIRMED / CORRECTION_NEEDED were ever written).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CriticalAssetAttestation" WHERE "outcome" IS NOT NULL AND "outcome" NOT IN ('CONFIRMED', 'CORRECTION_NEEDED')) THEN
    RAISE EXCEPTION 'CriticalAssetAttestation.outcome has unexpected values; fix them before this migration';
  END IF;
END $$;

CREATE TYPE "CriticalAssetOutcome" AS ENUM ('CONFIRMED', 'NEEDS_CORRECTION', 'NOT_FOUND');
UPDATE "CriticalAssetAttestation" SET "outcome" = 'NEEDS_CORRECTION' WHERE "outcome" = 'CORRECTION_NEEDED';
ALTER TABLE "CriticalAssetAttestation" ALTER COLUMN "outcome" TYPE "CriticalAssetOutcome" USING "outcome"::"CriticalAssetOutcome";

CREATE TYPE "CriticalAssetCorrectionStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

CREATE TABLE "CriticalAssetCorrection" (
    "id" UUID NOT NULL,
    "attestationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "groupId" UUID,
    "status" "CriticalAssetCorrectionStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "requestedBy" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" UUID,
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "changeReference" TEXT,
    CONSTRAINT "CriticalAssetCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CriticalAssetCorrection_siteId_status_idx" ON "CriticalAssetCorrection"("siteId", "status");
CREATE INDEX "CriticalAssetCorrection_attestationId_idx" ON "CriticalAssetCorrection"("attestationId");
ALTER TABLE "CriticalAssetCorrection" ADD CONSTRAINT "CriticalAssetCorrection_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "CriticalAssetAttestation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CriticalAssetCorrection" ADD CONSTRAINT "CriticalAssetCorrection_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CriticalAssetCorrection" ADD CONSTRAINT "CriticalAssetCorrection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Existing "correction needed" reviews become open correction requests, owned by the group that reviews the asset type.
INSERT INTO "CriticalAssetCorrection" ("id", "attestationId", "deviceId", "siteId", "groupId", "status", "description", "requestedBy", "requestedAt")
SELECT gen_random_uuid(), a."id", a."deviceId", a."siteId", m."groupId", 'OPEN', COALESCE(NULLIF(TRIM(a."notes"), ''), 'Correção pedida antes da migração 28a'), a."confirmedBy", COALESCE(a."confirmedAt", a."createdAt")
FROM "CriticalAssetAttestation" a
JOIN "Device" d ON d."id" = a."deviceId"
LEFT JOIN "CriticalAssetGroupMapping" m ON m."siteId" = a."siteId" AND m."assetType" = d."type"
WHERE a."outcome" = 'NEEDS_CORRECTION';
