CREATE TYPE "TopologyProposalAction" AS ENUM ('ADD', 'UPDATE', 'REMOVAL_CANDIDATE');
CREATE TYPE "TopologyProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'UNDONE');

CREATE TABLE "TopologyProposal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "interfaceId" UUID,
  "action" "TopologyProposalAction" NOT NULL,
  "status" "TopologyProposalStatus" NOT NULL DEFAULT 'PENDING',
  "proposalKey" TEXT NOT NULL,
  "observedIfIndex" INTEGER,
  "confidence" INTEGER NOT NULL,
  "source" "SourceType" NOT NULL DEFAULT 'SNMP',
  "context" JSONB,
  "beforeValues" JSONB,
  "observedValues" JSONB,
  "appliedEntityId" UUID,
  "reviewedBy" UUID,
  "reviewedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "undoneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TopologyProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TopologyProposal_snapshotId_proposalKey_key" ON "TopologyProposal"("snapshotId", "proposalKey");
CREATE INDEX "TopologyProposal_deviceId_status_createdAt_idx" ON "TopologyProposal"("deviceId", "status", "createdAt");
ALTER TABLE "TopologyProposal" ADD CONSTRAINT "TopologyProposal_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopologyProposal" ADD CONSTRAINT "TopologyProposal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SnmpSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopologyProposal" ADD CONSTRAINT "TopologyProposal_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "DeviceInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;
