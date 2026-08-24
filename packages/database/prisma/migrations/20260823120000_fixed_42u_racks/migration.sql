-- Preserve equipment records that cannot be represented in the fixed 42U rack.
-- They remain active in inventory and are surfaced by the UI as unpositioned.
UPDATE "Device"
SET "rackId" = NULL,
    "rackUnitStart" = NULL
WHERE "rackId" IS NOT NULL
  AND "rackUnitStart" IS NOT NULL
  AND (
    "rackUnitStart" < 1
    OR COALESCE("rackUnitSize", 1) < 1
    OR "rackUnitStart" + COALESCE("rackUnitSize", 1) - 1 > 42
  );

-- Every rack now uses the application-owned 42U visual and cannot override it.
UPDATE "Rack"
SET "units" = 42,
    "modelId" = NULL,
    "frontAssetId" = NULL
WHERE "units" <> 42
   OR "modelId" IS NOT NULL
   OR "frontAssetId" IS NOT NULL;
