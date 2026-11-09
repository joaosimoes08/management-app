ALTER TYPE "TopologyProposalAction" ADD VALUE IF NOT EXISTS 'CONNECTION_ADD';
ALTER TYPE "TopologyProposalAction" ADD VALUE IF NOT EXISTS 'CONNECTION_UPDATE';

ALTER TABLE "TopologyProposal" ADD COLUMN "connectionId" UUID;
ALTER TABLE "TopologyProposal" ADD CONSTRAINT "TopologyProposal_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "DeviceConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LldpObservation" (
  "id" UUID NOT NULL,
  "deviceId" UUID NOT NULL,
  "snapshotId" UUID,
  "source" "SourceType" NOT NULL DEFAULT 'SNMP',
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confidence" INTEGER NOT NULL,
  "localPortNumber" INTEGER,
  "localPortId" TEXT,
  "localPortDescription" TEXT,
  "remoteChassisIdSubtype" INTEGER,
  "remoteChassisId" TEXT,
  "remotePortIdSubtype" INTEGER,
  "remotePortId" TEXT,
  "remotePortDescription" TEXT,
  "remoteSystemName" TEXT,
  "managementAddress" TEXT,
  "vlanId" INTEGER,
  "bridgePort" INTEGER,
  "rawIdentifiers" JSONB NOT NULL,
  "resolvedDeviceId" UUID,
  CONSTRAINT "LldpObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LldpObservation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LldpObservation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SnmpSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LldpObservation_deviceId_observedAt_idx" ON "LldpObservation"("deviceId", "observedAt");
CREATE INDEX "LldpObservation_resolvedDeviceId_observedAt_idx" ON "LldpObservation"("resolvedDeviceId", "observedAt");
