CREATE TYPE "OperationalAlertSeverity" AS ENUM ('CRITICAL', 'HIGH', 'WARNING', 'INFO');
CREATE TYPE "OperationalAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED');
CREATE TYPE "TopologyMapType" AS ENUM ('PHYSICAL', 'NETWORK', 'VLAN_SUBNET');
CREATE TYPE "DeviceConnectionType" AS ENUM ('PHYSICAL', 'LOGICAL');
CREATE TYPE "InventoryFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED');

CREATE TABLE "OperationalAlert" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "dedupKey" TEXT NOT NULL, "source" TEXT NOT NULL,
  "severity" "OperationalAlertSeverity" NOT NULL, "status" "OperationalAlertStatus" NOT NULL DEFAULT 'OPEN',
  "siteId" UUID, "entityType" TEXT, "entityId" TEXT, "title" TEXT NOT NULL, "detail" TEXT NOT NULL,
  "actionHref" TEXT, "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedById" UUID, "acknowledgedAt" TIMESTAMP(3), "snoozedUntil" TIMESTAMP(3), "snoozeReason" TEXT,
  "resolvedById" UUID, "resolvedAt" TIMESTAMP(3), "resolutionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationalAlert_dedupKey_key" ON "OperationalAlert"("dedupKey");
CREATE INDEX "OperationalAlert_siteId_status_severity_lastOccurredAt_idx" ON "OperationalAlert"("siteId", "status", "severity", "lastOccurredAt");
CREATE INDEX "OperationalAlert_source_status_lastOccurredAt_idx" ON "OperationalAlert"("source", "status", "lastOccurredAt");
CREATE INDEX "OperationalAlert_entityType_entityId_idx" ON "OperationalAlert"("entityType", "entityId");

CREATE TABLE "OperationalAlertUserState" (
  "alertId" UUID NOT NULL, "userId" UUID NOT NULL, "readAt" TIMESTAMP(3),
  CONSTRAINT "OperationalAlertUserState_pkey" PRIMARY KEY ("alertId", "userId")
);
CREATE INDEX "OperationalAlertUserState_userId_readAt_idx" ON "OperationalAlertUserState"("userId", "readAt");

CREATE TABLE "DashboardLayout" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "siteId" UUID NOT NULL, "role" "RoleName" NOT NULL,
  "config" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0, "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DashboardLayout_siteId_role_key" ON "DashboardLayout"("siteId", "role");

CREATE TABLE "UserDashboardPreference" (
  "userId" UUID NOT NULL, "siteId" UUID NOT NULL, "selectedRole" "RoleName" NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserDashboardPreference_pkey" PRIMARY KEY ("userId", "siteId")
);

CREATE TABLE "TopologyMap" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "siteId" UUID NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "type" "TopologyMapType" NOT NULL, "viewport" JSONB, "filters" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 0, "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopologyMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TopologyMap_siteId_name_key" ON "TopologyMap"("siteId", "name");
CREATE INDEX "TopologyMap_siteId_type_idx" ON "TopologyMap"("siteId", "type");

CREATE TABLE "TopologyMapNode" (
  "mapId" UUID NOT NULL, "deviceId" UUID NOT NULL, "x" DOUBLE PRECISION NOT NULL, "y" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION, "height" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopologyMapNode_pkey" PRIMARY KEY ("mapId", "deviceId")
);
CREATE INDEX "TopologyMapNode_deviceId_idx" ON "TopologyMapNode"("deviceId");

CREATE TABLE "DeviceConnection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "siteId" UUID NOT NULL, "type" "DeviceConnectionType" NOT NULL,
  "label" TEXT, "notes" TEXT, "sourceDeviceId" UUID NOT NULL, "sourceInterfaceId" UUID,
  "targetDeviceId" UUID NOT NULL, "targetInterfaceId" UUID, "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceConnection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeviceConnection_siteId_type_idx" ON "DeviceConnection"("siteId", "type");
CREATE INDEX "DeviceConnection_sourceDeviceId_idx" ON "DeviceConnection"("sourceDeviceId");
CREATE INDEX "DeviceConnection_targetDeviceId_idx" ON "DeviceConnection"("targetDeviceId");

CREATE TABLE "TopologyMapConnection" (
  "mapId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  CONSTRAINT "TopologyMapConnection_pkey" PRIMARY KEY ("mapId", "connectionId")
);
CREATE INDEX "TopologyMapConnection_connectionId_idx" ON "TopologyMapConnection"("connectionId");

CREATE TABLE "InventoryFinding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "dedupKey" TEXT NOT NULL, "siteId" UUID, "rule" TEXT NOT NULL,
  "severity" "OperationalAlertSeverity" NOT NULL, "status" "InventoryFindingStatus" NOT NULL DEFAULT 'OPEN',
  "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "title" TEXT NOT NULL, "detail" TEXT NOT NULL, "metadata" JSONB,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1, "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "assignedToId" UUID, "acknowledgedById" UUID,
  "acknowledgedAt" TIMESTAMP(3), "snoozedUntil" TIMESTAMP(3), "snoozeReason" TEXT, "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryFinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryFinding_dedupKey_key" ON "InventoryFinding"("dedupKey");
CREATE INDEX "InventoryFinding_siteId_status_severity_lastDetectedAt_idx" ON "InventoryFinding"("siteId", "status", "severity", "lastDetectedAt");
CREATE INDEX "InventoryFinding_assignedToId_status_idx" ON "InventoryFinding"("assignedToId", "status");
CREATE INDEX "InventoryFinding_entityType_entityId_idx" ON "InventoryFinding"("entityType", "entityId");

ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalAlertUserState" ADD CONSTRAINT "OperationalAlertUserState_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "OperationalAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalAlertUserState" ADD CONSTRAINT "OperationalAlertUserState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserDashboardPreference" ADD CONSTRAINT "UserDashboardPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDashboardPreference" ADD CONSTRAINT "UserDashboardPreference_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopologyMap" ADD CONSTRAINT "TopologyMap_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopologyMap" ADD CONSTRAINT "TopologyMap_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopologyMapNode" ADD CONSTRAINT "TopologyMapNode_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "TopologyMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopologyMapNode" ADD CONSTRAINT "TopologyMapNode_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_sourceDeviceId_fkey" FOREIGN KEY ("sourceDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_sourceInterfaceId_fkey" FOREIGN KEY ("sourceInterfaceId") REFERENCES "DeviceInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_targetDeviceId_fkey" FOREIGN KEY ("targetDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_targetInterfaceId_fkey" FOREIGN KEY ("targetInterfaceId") REFERENCES "DeviceInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TopologyMapConnection" ADD CONSTRAINT "TopologyMapConnection_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "TopologyMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TopologyMapConnection" ADD CONSTRAINT "TopologyMapConnection_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "DeviceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryFinding" ADD CONSTRAINT "InventoryFinding_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryFinding" ADD CONSTRAINT "InventoryFinding_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryFinding" ADD CONSTRAINT "InventoryFinding_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
