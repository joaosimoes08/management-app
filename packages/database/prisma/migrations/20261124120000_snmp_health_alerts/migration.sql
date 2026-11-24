-- SNMP Phase 2 step 9 (additive): health history (kept 30 days by the snmp worker) and per-Site / per-Device
-- health alert limits. Two new tables only; no existing table or column is changed, so `prisma migrate deploy` is safe
-- on a live database.

-- CreateTable
CREATE TABLE "SnmpDeviceHealthSample" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "cpu5sPercent" DOUBLE PRECISION,
    "cpu1mPercent" DOUBLE PRECISION,
    "cpu5mPercent" DOUBLE PRECISION,
    "memoryUsedPercent" DOUBLE PRECISION,
    "maxTemperatureCelsius" DOUBLE PRECISION,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "rebooted" BOOLEAN NOT NULL DEFAULT false,
    "interfaceErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnmpDeviceHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnmpHealthThreshold" (
    "id" UUID NOT NULL,
    "siteId" UUID,
    "deviceId" UUID,
    "cpuPercent" DOUBLE PRECISION,
    "cpuSustainMinutes" INTEGER,
    "memoryPercent" DOUBLE PRECISION,
    "temperatureHighCelsius" DOUBLE PRECISION,
    "temperatureCriticalCelsius" DOUBLE PRECISION,
    "interfaceErrorsPerMinute" DOUBLE PRECISION,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnmpHealthThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnmpDeviceHealthSample_deviceId_observedAt_idx" ON "SnmpDeviceHealthSample"("deviceId", "observedAt");

-- CreateIndex
CREATE INDEX "SnmpDeviceHealthSample_observedAt_idx" ON "SnmpDeviceHealthSample"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SnmpHealthThreshold_siteId_key" ON "SnmpHealthThreshold"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "SnmpHealthThreshold_deviceId_key" ON "SnmpHealthThreshold"("deviceId");

-- AddForeignKey
ALTER TABLE "SnmpDeviceHealthSample" ADD CONSTRAINT "SnmpDeviceHealthSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnmpHealthThreshold" ADD CONSTRAINT "SnmpHealthThreshold_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnmpHealthThreshold" ADD CONSTRAINT "SnmpHealthThreshold_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A threshold row belongs to exactly one Site or one Device (Prisma does not model CHECK constraints).
ALTER TABLE "SnmpHealthThreshold" ADD CONSTRAINT "SnmpHealthThreshold_scope_check" CHECK (("siteId" IS NULL) <> ("deviceId" IS NULL));
