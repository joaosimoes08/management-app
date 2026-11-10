ALTER TABLE "Site" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon';
ALTER TABLE "Device" ADD COLUMN "isCritical" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CriticalAssetGroupMapping" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "assetType" TEXT NOT NULL,
    "groupId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CriticalAssetGroupMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CriticalAssetGroupMapping_siteId_assetType_key" ON "CriticalAssetGroupMapping"("siteId", "assetType");
CREATE INDEX "CriticalAssetGroupMapping_groupId_idx" ON "CriticalAssetGroupMapping"("groupId");
ALTER TABLE "CriticalAssetGroupMapping" ADD CONSTRAINT "CriticalAssetGroupMapping_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CriticalAssetGroupMapping" ADD CONSTRAINT "CriticalAssetGroupMapping_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CriticalAssetAttestation" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CriticalAssetAttestation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CriticalAssetAttestation_deviceId_weekStart_key" ON "CriticalAssetAttestation"("deviceId", "weekStart");
CREATE INDEX "CriticalAssetAttestation_siteId_weekStart_idx" ON "CriticalAssetAttestation"("siteId", "weekStart");
ALTER TABLE "CriticalAssetAttestation" ADD CONSTRAINT "CriticalAssetAttestation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CriticalAssetAttestation" ADD CONSTRAINT "CriticalAssetAttestation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
