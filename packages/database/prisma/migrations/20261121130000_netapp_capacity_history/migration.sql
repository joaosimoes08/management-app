-- Additive: NetApp capacity history for trends. Existing NetAppIntegration.snapshot is unchanged.
CREATE TYPE "NetAppSampleKind" AS ENUM ('CLUSTER', 'AGGREGATE', 'VOLUME');

CREATE TABLE "NetAppCapacitySample" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "kind" "NetAppSampleKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "svm" TEXT,
    "state" TEXT,
    "sizeBytes" BIGINT,
    "usedBytes" BIGINT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NetAppCapacitySample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NetAppCapacitySample_integrationId_kind_objectKey_observedA_idx" ON "NetAppCapacitySample"("integrationId", "kind", "objectKey", "observedAt");
CREATE INDEX "NetAppCapacitySample_integrationId_observedAt_idx" ON "NetAppCapacitySample"("integrationId", "observedAt");

ALTER TABLE "NetAppCapacitySample" ADD CONSTRAINT "NetAppCapacitySample_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "NetAppIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
