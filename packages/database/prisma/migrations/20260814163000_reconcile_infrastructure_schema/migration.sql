-- The infrastructure migration was recorded as applied in some databases before
-- its final schema objects were present. Keep this reconciliation migration
-- idempotent so it is safe for those databases and no-ops for complete ones.

ALTER TABLE "DeviceInterface" ADD COLUMN IF NOT EXISTS "portKey" TEXT;
ALTER TABLE "DeviceModel" ADD COLUMN IF NOT EXISTS "backAssetId" UUID;
ALTER TABLE "DeviceModel" ADD COLUMN IF NOT EXISTS "frontAssetId" UUID;
ALTER TABLE "DeviceModel" ADD COLUMN IF NOT EXISTS "iconAssetId" UUID;
ALTER TABLE "DeviceModel" ADD COLUMN IF NOT EXISTS "portLayout" JSONB;
ALTER TABLE "Rack" ADD COLUMN IF NOT EXISTS "modelId" UUID;

CREATE TABLE IF NOT EXISTS "AssetFile" (
  "id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "license" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssetFile_storageKey_key" ON "AssetFile"("storageKey");

CREATE TABLE IF NOT EXISTS "RackModel" (
  "id" UUID NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 42,
  "widthMm" INTEGER,
  "depthMm" INTEGER,
  "iconAssetId" UUID,
  "frontAssetId" UUID,
  "capabilities" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "RackModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RackModel_manufacturer_model_key" ON "RackModel"("manufacturer", "model");

CREATE TABLE IF NOT EXISTS "DiscoverySchedule" (
  "id" UUID NOT NULL,
  "subnetId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalHours" INTEGER NOT NULL DEFAULT 12,
  "methods" JSONB NOT NULL,
  "tcpPorts" JSONB,
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscoverySchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoverySchedule_subnetId_key" ON "DiscoverySchedule"("subnetId");
CREATE INDEX IF NOT EXISTS "Subnet_vlanId_idx" ON "Subnet"("vlanId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Rack_modelId_fkey') THEN
    ALTER TABLE "Rack" ADD CONSTRAINT "Rack_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RackModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RackModel_iconAssetId_fkey') THEN
    ALTER TABLE "RackModel" ADD CONSTRAINT "RackModel_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RackModel_frontAssetId_fkey') THEN
    ALTER TABLE "RackModel" ADD CONSTRAINT "RackModel_frontAssetId_fkey" FOREIGN KEY ("frontAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeviceModel_frontAssetId_fkey') THEN
    ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_frontAssetId_fkey" FOREIGN KEY ("frontAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeviceModel_backAssetId_fkey') THEN
    ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_backAssetId_fkey" FOREIGN KEY ("backAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeviceModel_iconAssetId_fkey') THEN
    ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscoverySchedule_subnetId_fkey') THEN
    ALTER TABLE "DiscoverySchedule" ADD CONSTRAINT "DiscoverySchedule_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
