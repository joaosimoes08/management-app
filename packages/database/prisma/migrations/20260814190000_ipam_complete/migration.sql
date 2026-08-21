CREATE TYPE "NatRuleType" AS ENUM ('SNAT', 'DNAT', 'STATIC_1_TO_1', 'PAT');

ALTER TABLE "IpAddress" ADD COLUMN "icmpReachable" BOOLEAN, ADD COLUMN "lastCheckAt" TIMESTAMP(3), ADD COLUMN "lastCheckMethod" TEXT, ADD COLUMN "observedState" TEXT, ADD COLUMN "openPorts" JSONB, ADD COLUMN "responseMs" INTEGER, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "Subnet" ADD COLUMN "lastScanAt" TIMESTAMP(3), ADD COLUMN "lastScanError" TEXT, ADD COLUMN "lastScanStatus" TEXT, ADD COLUMN "nextScanAt" TIMESTAMP(3), ADD COLUMN "parentSubnetId" UUID, ADD COLUMN "reverseDnsEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "scanEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "scanIntervalHours" INTEGER NOT NULL DEFAULT 12, ADD COLUMN "scanMethods" JSONB, ADD COLUMN "scanTcpPorts" JSONB, ADD COLUMN "vrfId" UUID;

CREATE TABLE "Vrf" ("id" UUID NOT NULL, "name" TEXT NOT NULL, "routeDistinguisher" TEXT, "description" TEXT, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "siteId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Vrf_pkey" PRIMARY KEY ("id"));
CREATE TABLE "NatRule" ("id" UUID NOT NULL, "name" TEXT NOT NULL, "type" "NatRuleType" NOT NULL, "protocol" TEXT, "sourceAddress" TEXT, "translatedAddress" TEXT, "sourcePort" INTEGER, "translatedPort" INTEGER, "destinationPort" INTEGER, "sourceSubnetId" UUID, "translatedSubnetId" UUID, "sourceIpId" UUID, "translatedIpId" UUID, "deviceId" UUID, "vrfId" UUID, "siteId" UUID, "enabled" BOOLEAN NOT NULL DEFAULT true, "description" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "NatRule_pkey" PRIMARY KEY ("id"));
CREATE TABLE "IpamGroup" ("id" UUID NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "siteId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "IpamGroup_pkey" PRIMARY KEY ("id"));
CREATE TABLE "IpamGroupMember" ("groupId" UUID NOT NULL, "userId" UUID NOT NULL, CONSTRAINT "IpamGroupMember_pkey" PRIMARY KEY ("groupId","userId"));
CREATE TABLE "IpamPermission" ("id" UUID NOT NULL, "groupId" UUID NOT NULL, "scopeType" TEXT NOT NULL, "scopeId" UUID NOT NULL, "permission" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "IpamPermission_pkey" PRIMARY KEY ("id"));

CREATE INDEX "Vrf_siteId_status_idx" ON "Vrf"("siteId", "status");
CREATE UNIQUE INDEX "Vrf_siteId_name_key" ON "Vrf"("siteId", "name");
CREATE INDEX "NatRule_type_enabled_idx" ON "NatRule"("type", "enabled");
CREATE INDEX "NatRule_deviceId_vrfId_idx" ON "NatRule"("deviceId", "vrfId");
CREATE UNIQUE INDEX "IpamGroup_siteId_name_key" ON "IpamGroup"("siteId", "name");
CREATE INDEX "IpamPermission_scopeType_scopeId_idx" ON "IpamPermission"("scopeType", "scopeId");
CREATE UNIQUE INDEX "IpamPermission_groupId_scopeType_scopeId_permission_key" ON "IpamPermission"("groupId", "scopeType", "scopeId", "permission");
CREATE INDEX "IpAddress_version_address_idx" ON "IpAddress"("version", "address");
CREATE INDEX "Subnet_siteId_vrfId_version_idx" ON "Subnet"("siteId", "vrfId", "version");

ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_vrfId_fkey" FOREIGN KEY ("vrfId") REFERENCES "Vrf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_parentSubnetId_fkey" FOREIGN KEY ("parentSubnetId") REFERENCES "Subnet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vrf" ADD CONSTRAINT "Vrf_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_sourceSubnetId_fkey" FOREIGN KEY ("sourceSubnetId") REFERENCES "Subnet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_translatedSubnetId_fkey" FOREIGN KEY ("translatedSubnetId") REFERENCES "Subnet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_sourceIpId_fkey" FOREIGN KEY ("sourceIpId") REFERENCES "IpAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_translatedIpId_fkey" FOREIGN KEY ("translatedIpId") REFERENCES "IpAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_vrfId_fkey" FOREIGN KEY ("vrfId") REFERENCES "Vrf"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NatRule" ADD CONSTRAINT "NatRule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpamGroup" ADD CONSTRAINT "IpamGroup_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpamGroupMember" ADD CONSTRAINT "IpamGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IpamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpamGroupMember" ADD CONSTRAINT "IpamGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpamPermission" ADD CONSTRAINT "IpamPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IpamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
