ALTER TABLE "SystemSettings"
  ADD COLUMN "discoveryAllowedCidrs" JSONB NOT NULL DEFAULT '["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16","fc00::/7"]';

ALTER TABLE "Host"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "source" "SourceType" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "observedHostname" TEXT,
  ADD COLUMN "observedStatus" TEXT,
  ADD COLUMN "deviceId" UUID;

ALTER TABLE "Service"
  ADD COLUMN "observedStatus" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "source" "SourceType" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Host_deviceId_key" ON "Host"("deviceId");
ALTER TABLE "Host" ADD CONSTRAINT "Host_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "DiscoveryJob_one_active_per_subnet"
  ON "DiscoveryJob"("subnetId")
  WHERE "status" IN ('PENDING', 'RUNNING');
