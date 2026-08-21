-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IpState" AS ENUM ('FREE', 'OCCUPIED', 'RESERVED', 'EXCLUDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'SNMP', 'AGENT', 'ICMP', 'TCP', 'DNS', 'DHCP', 'IMPORT');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR', 'READ_ONLY');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "role" "RoleName" NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" UUID NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "buildingId" UUID NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rack" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 42,
    "roomId" UUID NOT NULL,

    CONSTRAINT "Rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceModel" (
    "id" UUID NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "portCount" INTEGER,

    CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "serialNumber" TEXT,
    "assetTag" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'UNKNOWN',
    "modelId" UUID,
    "rackId" UUID,
    "rackUnitStart" INTEGER,
    "rackUnitSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceInterface" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "adminUp" BOOLEAN,
    "operUp" BOOLEAN,
    "speedMbps" INTEGER,
    "mode" TEXT,
    "nativeVlanId" UUID,
    "deviceId" UUID NOT NULL,

    CONSTRAINT "DeviceInterface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vlan" (
    "id" UUID NOT NULL,
    "vlanId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "siteId" UUID,

    CONSTRAINT "Vlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subnet" (
    "id" UUID NOT NULL,
    "cidr" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "gateway" TEXT,
    "purpose" TEXT,
    "environment" TEXT,
    "siteId" UUID,
    "vlanId" UUID,

    CONSTRAINT "Subnet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpAddress" (
    "id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "state" "IpState" NOT NULL DEFAULT 'UNKNOWN',
    "hostname" TEXT,
    "macAddress" TEXT,
    "source" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "lastSeenAt" TIMESTAMP(3),
    "notes" TEXT,
    "subnetId" UUID NOT NULL,
    "deviceId" UUID,
    "interfaceId" UUID,

    CONSTRAINT "IpAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Building_siteId_name_key" ON "Building"("siteId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Room_buildingId_name_key" ON "Room"("buildingId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Rack_roomId_name_key" ON "Rack"("roomId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceModel_manufacturer_model_key" ON "DeviceModel"("manufacturer", "model");

-- CreateIndex
CREATE INDEX "Device_type_status_idx" ON "Device"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceInterface_deviceId_name_key" ON "DeviceInterface"("deviceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vlan_siteId_vlanId_key" ON "Vlan"("siteId", "vlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Subnet_cidr_key" ON "Subnet"("cidr");

-- CreateIndex
CREATE INDEX "IpAddress_hostname_idx" ON "IpAddress"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "IpAddress_subnetId_address_key" ON "IpAddress"("subnetId", "address");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "DeviceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceInterface" ADD CONSTRAINT "DeviceInterface_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vlan" ADD CONSTRAINT "Vlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subnet" ADD CONSTRAINT "Subnet_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "DeviceInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;
