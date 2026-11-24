-- Discovery D-P1e (additive): ARP and MAC forwarding (bridge FDB) sightings read by the SNMP poller.
-- Two new tables only; no existing table or column is changed, so `prisma migrate deploy` is safe on a live database.
-- The restricted worker role needs the new grants in scripts/snmp-database-grants.sql.

-- CreateTable
CREATE TABLE "SnmpArpEntry" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "ifIndex" INTEGER,
    "interfaceName" TEXT,
    "entryType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "jobId" UUID,

    CONSTRAINT "SnmpArpEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnmpMacEntry" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "vlanId" INTEGER NOT NULL DEFAULT 0,
    "macAddress" TEXT NOT NULL,
    "bridgePort" INTEGER,
    "ifIndex" INTEGER,
    "interfaceName" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "jobId" UUID,

    CONSTRAINT "SnmpMacEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnmpArpEntry_macAddress_idx" ON "SnmpArpEntry"("macAddress");

-- CreateIndex
CREATE INDEX "SnmpArpEntry_ipAddress_idx" ON "SnmpArpEntry"("ipAddress");

-- CreateIndex
CREATE INDEX "SnmpArpEntry_lastSeenAt_idx" ON "SnmpArpEntry"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SnmpArpEntry_deviceId_ipAddress_macAddress_key" ON "SnmpArpEntry"("deviceId", "ipAddress", "macAddress");

-- CreateIndex
CREATE INDEX "SnmpMacEntry_macAddress_idx" ON "SnmpMacEntry"("macAddress");

-- CreateIndex
CREATE INDEX "SnmpMacEntry_lastSeenAt_idx" ON "SnmpMacEntry"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SnmpMacEntry_deviceId_vlanId_macAddress_key" ON "SnmpMacEntry"("deviceId", "vlanId", "macAddress");

-- AddForeignKey
ALTER TABLE "SnmpArpEntry" ADD CONSTRAINT "SnmpArpEntry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnmpMacEntry" ADD CONSTRAINT "SnmpMacEntry_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

