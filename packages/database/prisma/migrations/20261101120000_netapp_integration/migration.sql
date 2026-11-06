CREATE TABLE "NetAppIntegration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "siteId" UUID NOT NULL,
  "endpointUrl" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "iv" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "wrappedDek" BYTEA NOT NULL,
  "wrapIv" BYTEA NOT NULL,
  "wrapAuthTag" BYTEA NOT NULL,
  "keyId" TEXT NOT NULL,
  "snapshot" JSONB,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NetAppIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetAppIntegration_siteId_key" ON "NetAppIntegration"("siteId");
CREATE INDEX "NetAppIntegration_lastSuccessAt_idx" ON "NetAppIntegration"("lastSuccessAt");
ALTER TABLE "NetAppIntegration" ADD CONSTRAINT "NetAppIntegration_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
