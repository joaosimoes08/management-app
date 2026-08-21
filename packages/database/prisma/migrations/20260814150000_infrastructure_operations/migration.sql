ALTER TABLE "DeviceModel" ADD COLUMN "type" TEXT;
ALTER TABLE "DeviceModel" ADD COLUMN "capabilities" JSONB;

CREATE TABLE "AssetFile" (
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
CREATE UNIQUE INDEX "AssetFile_storageKey_key" ON "AssetFile"("storageKey");

CREATE TABLE "RackModel" (
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
CREATE UNIQUE INDEX "RackModel_manufacturer_model_key" ON "RackModel"("manufacturer", "model");
ALTER TABLE "RackModel" ADD CONSTRAINT "RackModel_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RackModel" ADD CONSTRAINT "RackModel_frontAssetId_fkey" FOREIGN KEY ("frontAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rack" ADD COLUMN "modelId" UUID;
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RackModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceModel" ADD COLUMN "frontAssetId" UUID;
ALTER TABLE "DeviceModel" ADD COLUMN "backAssetId" UUID;
ALTER TABLE "DeviceModel" ADD COLUMN "iconAssetId" UUID;
ALTER TABLE "DeviceModel" ADD COLUMN "portLayout" JSONB;
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_frontAssetId_fkey" FOREIGN KEY ("frontAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_backAssetId_fkey" FOREIGN KEY ("backAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Device" ADD COLUMN "hostname" TEXT;
ALTER TABLE "Device" ADD COLUMN "managementIp" TEXT;
ALTER TABLE "Device" ADD COLUMN "notes" TEXT;
ALTER TABLE "Device" ADD COLUMN "source" "SourceType" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Device" ADD COLUMN "siteId" UUID;
CREATE INDEX "Device_siteId_idx" ON "Device"("siteId");
ALTER TABLE "Device" ADD CONSTRAINT "Device_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeviceInterface" ADD COLUMN "accessVlanId" UUID;
ALTER TABLE "DeviceInterface" ADD COLUMN "portKey" TEXT;
ALTER TABLE "DeviceInterface" ADD COLUMN "macAddress" TEXT;
ALTER TABLE "DeviceInterface" ADD COLUMN "source" "SourceType" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "DeviceInterface" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "DeviceInterface" ADD CONSTRAINT "DeviceInterface_nativeVlanId_fkey" FOREIGN KEY ("nativeVlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceInterface" ADD CONSTRAINT "DeviceInterface_accessVlanId_fkey" FOREIGN KEY ("accessVlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InterfaceVlan" (
  "interfaceId" UUID NOT NULL,
  "vlanId" UUID NOT NULL,
  "tagged" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "InterfaceVlan_pkey" PRIMARY KEY ("interfaceId", "vlanId")
);
ALTER TABLE "InterfaceVlan" ADD CONSTRAINT "InterfaceVlan_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "DeviceInterface"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterfaceVlan" ADD CONSTRAINT "InterfaceVlan_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Subnet_vlanId_unique" ON "Subnet"("vlanId") WHERE "vlanId" IS NOT NULL;
CREATE TABLE "DiscoverySchedule" (
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
CREATE UNIQUE INDEX "DiscoverySchedule_subnetId_key" ON "DiscoverySchedule"("subnetId");
ALTER TABLE "DiscoverySchedule" ADD CONSTRAINT "DiscoverySchedule_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
