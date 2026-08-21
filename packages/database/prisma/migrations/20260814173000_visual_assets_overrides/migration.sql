ALTER TABLE "Rack" ADD COLUMN "frontAssetId" UUID;
ALTER TABLE "Device" ADD COLUMN "frontAssetId" UUID;
ALTER TABLE "Device" ADD COLUMN "iconAssetId" UUID;

CREATE INDEX "Rack_frontAssetId_idx" ON "Rack"("frontAssetId");
CREATE INDEX "Device_frontAssetId_idx" ON "Device"("frontAssetId");
CREATE INDEX "Device_iconAssetId_idx" ON "Device"("iconAssetId");

ALTER TABLE "Rack" ADD CONSTRAINT "Rack_frontAssetId_fkey" FOREIGN KEY ("frontAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_frontAssetId_fkey" FOREIGN KEY ("frontAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_iconAssetId_fkey" FOREIGN KEY ("iconAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
