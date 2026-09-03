-- CreateEnum
CREATE TYPE "SnmpVersion" AS ENUM ('V2C', 'V3');
CREATE TYPE "SnmpCredentialPurpose" AS ENUM ('READ', 'WRITE', 'TRAP');
CREATE TYPE "SnmpJobType" AS ENUM ('POLL', 'CREDENTIAL_TEST', 'SET');
CREATE TYPE "SnmpJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED');
CREATE TYPE "SnmpTrapStatus" AS ENUM ('PENDING', 'PROCESSED', 'UNMATCHED', 'FAILED');
CREATE TYPE "SnmpDriftStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IGNORED');
CREATE TYPE "SnmpWriteOperation" AS ENUM ('INTERFACE_ADMIN_STATUS', 'SYSTEM_IDENTITY');
CREATE TYPE "SnmpWriteStatus" AS ENUM ('PREVIEW', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'NEEDS_ATTENTION');

-- CreateTable
CREATE TABLE "SnmpDeviceConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "port" INTEGER NOT NULL DEFAULT 161,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
  "retries" INTEGER NOT NULL DEFAULT 2,
  "compatibilitySha1" BOOLEAN NOT NULL DEFAULT false,
  "lastPollAt" TIMESTAMP(3),
  "nextPollAt" TIMESTAMP(3),
  "lastStatus" "SnmpJobStatus",
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SnmpDeviceConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpCredential" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "purpose" "SnmpCredentialPurpose" NOT NULL,
  "version" "SnmpVersion" NOT NULL,
  "label" TEXT,
  "username" TEXT,
  "authProtocol" TEXT,
  "privProtocol" TEXT,
  "ciphertext" BYTEA NOT NULL,
  "iv" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "wrappedDek" BYTEA NOT NULL,
  "wrapIv" BYTEA NOT NULL,
  "wrapAuthTag" BYTEA NOT NULL,
  "keyId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastTestedAt" TIMESTAMP(3),
  "lastTestStatus" "SnmpJobStatus",
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SnmpCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "credentialId" UUID,
  "type" "SnmpJobType" NOT NULL,
  "status" "SnmpJobStatus" NOT NULL DEFAULT 'PENDING',
  "requestedBy" UUID,
  "errorCode" TEXT,
  "metadata" JSONB,
  "result" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnmpJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "sysName" TEXT,
  "sysDescr" TEXT,
  "sysObjectId" TEXT,
  "sysLocation" TEXT,
  "uptimeTicks" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw" JSONB,
  CONSTRAINT "SnmpSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpInterfaceObservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "snapshotId" UUID NOT NULL,
  "deviceInterfaceId" UUID,
  "ifIndex" INTEGER NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "alias" TEXT,
  "interfaceType" INTEGER,
  "macAddress" TEXT,
  "adminUp" BOOLEAN,
  "operUp" BOOLEAN,
  "speedMbps" INTEGER,
  "counters" JSONB,
  CONSTRAINT "SnmpInterfaceObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpTrapEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID,
  "credentialId" UUID,
  "sourceAddress" TEXT NOT NULL,
  "sourcePort" INTEGER NOT NULL,
  "version" "SnmpVersion" NOT NULL,
  "authIdentity" TEXT NOT NULL,
  "engineId" TEXT,
  "requestId" TEXT,
  "pduType" TEXT NOT NULL,
  "trapOid" TEXT,
  "uptimeTicks" TEXT,
  "varbinds" JSONB NOT NULL,
  "status" "SnmpTrapStatus" NOT NULL DEFAULT 'PENDING',
  "category" TEXT,
  "severity" TEXT,
  "dedupKey" TEXT,
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SnmpTrapEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpDrift" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "interfaceId" UUID,
  "snapshotId" UUID NOT NULL,
  "field" TEXT NOT NULL,
  "documentedValue" JSONB,
  "observedValue" JSONB,
  "status" "SnmpDriftStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedBy" UUID,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnmpDrift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SnmpWriteRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "deviceId" UUID NOT NULL,
  "jobId" UUID,
  "operation" "SnmpWriteOperation" NOT NULL,
  "parameters" JSONB NOT NULL,
  "beforeValues" JSONB,
  "desiredValues" JSONB NOT NULL,
  "verifiedValues" JSONB,
  "status" "SnmpWriteStatus" NOT NULL DEFAULT 'PREVIEW',
  "requestedBy" UUID NOT NULL,
  "errorCode" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SnmpWriteRequest_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "SnmpDeviceConfig_deviceId_key" ON "SnmpDeviceConfig"("deviceId");
CREATE UNIQUE INDEX "SnmpCredential_deviceId_purpose_key" ON "SnmpCredential"("deviceId", "purpose");
CREATE INDEX "SnmpCredential_purpose_version_enabled_idx" ON "SnmpCredential"("purpose", "version", "enabled");
CREATE INDEX "SnmpCredential_username_purpose_idx" ON "SnmpCredential"("username", "purpose");
CREATE INDEX "SnmpJob_deviceId_createdAt_idx" ON "SnmpJob"("deviceId", "createdAt");
CREATE INDEX "SnmpJob_status_type_createdAt_idx" ON "SnmpJob"("status", "type", "createdAt");
CREATE UNIQUE INDEX "SnmpSnapshot_jobId_key" ON "SnmpSnapshot"("jobId");
CREATE INDEX "SnmpSnapshot_deviceId_observedAt_idx" ON "SnmpSnapshot"("deviceId", "observedAt");
CREATE UNIQUE INDEX "SnmpInterfaceObservation_snapshotId_ifIndex_key" ON "SnmpInterfaceObservation"("snapshotId", "ifIndex");
CREATE INDEX "SnmpInterfaceObservation_deviceInterfaceId_idx" ON "SnmpInterfaceObservation"("deviceInterfaceId");
CREATE UNIQUE INDEX "SnmpTrapEvent_dedupKey_key" ON "SnmpTrapEvent"("dedupKey");
CREATE INDEX "SnmpTrapEvent_deviceId_receivedAt_idx" ON "SnmpTrapEvent"("deviceId", "receivedAt");
CREATE INDEX "SnmpTrapEvent_credentialId_receivedAt_idx" ON "SnmpTrapEvent"("credentialId", "receivedAt");
CREATE INDEX "SnmpTrapEvent_status_receivedAt_idx" ON "SnmpTrapEvent"("status", "receivedAt");
CREATE INDEX "SnmpTrapEvent_expiresAt_idx" ON "SnmpTrapEvent"("expiresAt");
CREATE INDEX "SnmpDrift_deviceId_status_createdAt_idx" ON "SnmpDrift"("deviceId", "status", "createdAt");
CREATE INDEX "SnmpDrift_interfaceId_status_idx" ON "SnmpDrift"("interfaceId", "status");
CREATE UNIQUE INDEX "SnmpWriteRequest_jobId_key" ON "SnmpWriteRequest"("jobId");
CREATE INDEX "SnmpWriteRequest_deviceId_requestedAt_idx" ON "SnmpWriteRequest"("deviceId", "requestedAt");
CREATE INDEX "SnmpWriteRequest_status_requestedAt_idx" ON "SnmpWriteRequest"("status", "requestedAt");

-- Foreign keys
ALTER TABLE "SnmpDeviceConfig" ADD CONSTRAINT "SnmpDeviceConfig_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpCredential" ADD CONSTRAINT "SnmpCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpJob" ADD CONSTRAINT "SnmpJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpJob" ADD CONSTRAINT "SnmpJob_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "SnmpCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SnmpSnapshot" ADD CONSTRAINT "SnmpSnapshot_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpSnapshot" ADD CONSTRAINT "SnmpSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SnmpJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpInterfaceObservation" ADD CONSTRAINT "SnmpInterfaceObservation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SnmpSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpInterfaceObservation" ADD CONSTRAINT "SnmpInterfaceObservation_deviceInterfaceId_fkey" FOREIGN KEY ("deviceInterfaceId") REFERENCES "DeviceInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SnmpTrapEvent" ADD CONSTRAINT "SnmpTrapEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SnmpTrapEvent" ADD CONSTRAINT "SnmpTrapEvent_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "SnmpCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SnmpDrift" ADD CONSTRAINT "SnmpDrift_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpDrift" ADD CONSTRAINT "SnmpDrift_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "DeviceInterface"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpDrift" ADD CONSTRAINT "SnmpDrift_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SnmpSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpWriteRequest" ADD CONSTRAINT "SnmpWriteRequest_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpWriteRequest" ADD CONSTRAINT "SnmpWriteRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SnmpJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
