ALTER TABLE "Rack" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

WITH ordered_racks AS (
  SELECT id, CAST(ROW_NUMBER() OVER (PARTITION BY "roomId" ORDER BY name, id) - 1 AS INTEGER) AS position
  FROM "Rack"
)
UPDATE "Rack"
SET "displayOrder" = ordered_racks.position
FROM ordered_racks
WHERE "Rack".id = ordered_racks.id;

CREATE INDEX "Rack_roomId_displayOrder_idx" ON "Rack"("roomId", "displayOrder");
