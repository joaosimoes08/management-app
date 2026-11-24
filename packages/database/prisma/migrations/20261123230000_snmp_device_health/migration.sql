-- SNMP Phase 2 step 8 (additive): latest device-health reading per device (CPU, memory, environment, stack, reboot).
-- New table only; no existing table or column is changed, so `prisma migrate deploy` is safe on a live database.

-- CreateTable
CREATE TABLE "SnmpDeviceHealth" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "jobId" UUID,
    "vendor" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "uptimeTicks" BIGINT,
    "bootedAt" TIMESTAMP(3),
    "rebootDetectedAt" TIMESTAMP(3),
    "rebootCount" INTEGER NOT NULL DEFAULT 0,
    "cpu5sPercent" DOUBLE PRECISION,
    "cpu1mPercent" DOUBLE PRECISION,
    "cpu5mPercent" DOUBLE PRECISION,
    "memoryUsedPercent" DOUBLE PRECISION,
    "memoryUsedBytes" BIGINT,
    "memoryTotalBytes" BIGINT,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnmpDeviceHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SnmpDeviceHealth_deviceId_key" ON "SnmpDeviceHealth"("deviceId");

-- CreateIndex
CREATE INDEX "SnmpDeviceHealth_status_idx" ON "SnmpDeviceHealth"("status");

-- AddForeignKey
ALTER TABLE "SnmpDeviceHealth" ADD CONSTRAINT "SnmpDeviceHealth_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
