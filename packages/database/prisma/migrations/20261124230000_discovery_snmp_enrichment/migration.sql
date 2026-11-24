-- D-P1a: optional SNMP enrichment in discovery, per subnet. Additive only: nullable columns, columns with defaults,
-- indexes and ON DELETE SET NULL foreign keys. No existing row changes meaning (null credential = enrichment off).

-- AlterTable
ALTER TABLE "Subnet" ADD COLUMN     "discoverySnmpCredentialId" UUID;

-- AlterTable
ALTER TABLE "DiscoveryJob" ADD COLUMN     "snmpCredentialId" UUID,
ADD COLUMN     "snmpEnrichedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "snmpFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "snmpSkippedReason" TEXT;

-- AlterTable
ALTER TABLE "DiscoveryResult" ADD COLUMN     "snmp" JSONB;

-- CreateIndex
CREATE INDEX "Subnet_discoverySnmpCredentialId_idx" ON "Subnet"("discoverySnmpCredentialId");

-- CreateIndex
CREATE INDEX "DiscoveryJob_snmpCredentialId_idx" ON "DiscoveryJob"("snmpCredentialId");

-- AddForeignKey
ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_discoverySnmpCredentialId_fkey" FOREIGN KEY ("discoverySnmpCredentialId") REFERENCES "SnmpCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryJob" ADD CONSTRAINT "DiscoveryJob_snmpCredentialId_fkey" FOREIGN KEY ("snmpCredentialId") REFERENCES "SnmpCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

