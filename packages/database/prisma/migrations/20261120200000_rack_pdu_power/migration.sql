-- Rack PDUs, outlet allocation and wattage estimates.
-- Additive: new enum, two new tables and nullable columns. Safe to apply on a live database.
-- Backfill: every existing rack gets one SUPPLIER ("Rede") PDU with 32 outlets and a 3680 W budget (16 A / 230 V).
-- No device is auto-connected; existing devices show as "Não ligado" until an operator assigns outlets.
-- Defaults used by the API afterwards live in apps/api/src/infrastructure/power/power-defaults.ts.

-- CreateEnum
CREATE TYPE "PowerFeedSource" AS ENUM ('SUPPLIER', 'UPS');

-- AlterTable
ALTER TABLE "DeviceModel" ADD COLUMN     "maxWatts" INTEGER,
ADD COLUMN     "powerPlugCount" INTEGER,
ADD COLUMN     "typicalWatts" INTEGER;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "estimatedWatts" INTEGER,
ADD COLUMN     "powerPlugCount" INTEGER;

-- CreateTable
CREATE TABLE "RackPdu" (
    "id" UUID NOT NULL,
    "rackId" UUID NOT NULL,
    "source" "PowerFeedSource" NOT NULL,
    "name" TEXT,
    "outletCount" INTEGER NOT NULL DEFAULT 32,
    "budgetWatts" INTEGER DEFAULT 3680,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RackPdu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PduOutletAssignment" (
    "id" UUID NOT NULL,
    "pduId" UUID NOT NULL,
    "outletIndex" INTEGER NOT NULL,
    "deviceId" UUID NOT NULL,
    "plugIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PduOutletAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RackPdu_rackId_source_key" ON "RackPdu"("rackId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "PduOutletAssignment_pduId_outletIndex_key" ON "PduOutletAssignment"("pduId", "outletIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PduOutletAssignment_deviceId_plugIndex_key" ON "PduOutletAssignment"("deviceId", "plugIndex");

-- AddForeignKey
ALTER TABLE "RackPdu" ADD CONSTRAINT "RackPdu_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PduOutletAssignment" ADD CONSTRAINT "PduOutletAssignment_pduId_fkey" FOREIGN KEY ("pduId") REFERENCES "RackPdu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PduOutletAssignment" ADD CONSTRAINT "PduOutletAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sanity checks the API also enforces.
ALTER TABLE "RackPdu" ADD CONSTRAINT "RackPdu_outletCount_check" CHECK ("outletCount" >= 1);
ALTER TABLE "RackPdu" ADD CONSTRAINT "RackPdu_budgetWatts_check" CHECK ("budgetWatts" IS NULL OR "budgetWatts" >= 0);
ALTER TABLE "PduOutletAssignment" ADD CONSTRAINT "PduOutletAssignment_outletIndex_check" CHECK ("outletIndex" >= 1);
ALTER TABLE "PduOutletAssignment" ADD CONSTRAINT "PduOutletAssignment_plugIndex_check" CHECK ("plugIndex" >= 1);

-- Backfill: one supplier PDU per existing rack (idempotent thanks to the (rackId, source) unique index).
INSERT INTO "RackPdu" ("id", "rackId", "source", "name", "outletCount", "budgetWatts", "createdAt", "updatedAt")
SELECT gen_random_uuid(), r."id", 'SUPPLIER', NULL, 32, 3680, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Rack" r
ON CONFLICT ("rackId", "source") DO NOTHING;
