ALTER TABLE "TopologyProposal" DROP CONSTRAINT "TopologyProposal_deviceId_fkey";
ALTER TABLE "TopologyProposal" DROP CONSTRAINT "TopologyProposal_snapshotId_fkey";

ALTER TABLE "TopologyProposal" ALTER COLUMN "deviceId" DROP NOT NULL;
ALTER TABLE "TopologyProposal" ALTER COLUMN "snapshotId" DROP NOT NULL;

ALTER TABLE "TopologyProposal" ADD CONSTRAINT "TopologyProposal_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopologyProposal" ADD CONSTRAINT "TopologyProposal_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "SnmpSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
