-- Rack front and rear views: per-device rear image override (falls back to DeviceModel.backAssetId).
-- Additive and nullable: safe to apply on a live database. The one-time "front images are really rear" data move
-- is NOT part of this migration; it is the manual script apps/api/src/scripts/migrate-rack-faces.ts (see docs/rack-front-rear-migration.md).
ALTER TABLE "Device" ADD COLUMN "backAssetId" UUID;

ALTER TABLE "Device" ADD CONSTRAINT "Device_backAssetId_fkey" FOREIGN KEY ("backAssetId") REFERENCES "AssetFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
