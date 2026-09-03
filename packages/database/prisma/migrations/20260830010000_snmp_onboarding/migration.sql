-- Additive SNMP trap discovery/onboarding support.
ALTER TYPE "SnmpTrapStatus" ADD VALUE IF NOT EXISTS 'DISCOVERED';
CREATE TYPE "SnmpTrapEnrollmentStatus" AS ENUM ('WAITING', 'DISCOVERED');

-- A management address may be reused in different Sites, but not twice inside one Site.
CREATE UNIQUE INDEX "Device_siteId_managementIp_key" ON "Device"("siteId", "managementIp");

CREATE TABLE "SnmpTrapEnrollment" (
  "id" UUID NOT NULL,
  "siteId" UUID NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "version" "SnmpVersion" NOT NULL,
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
  "status" "SnmpTrapEnrollmentStatus" NOT NULL DEFAULT 'WAITING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "firstSeenAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "trapCount" INTEGER NOT NULL DEFAULT 0,
  "latestTrapOid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SnmpTrapEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SnmpTrapEnrollment_siteId_status_expiresAt_idx" ON "SnmpTrapEnrollment"("siteId", "status", "expiresAt");
CREATE UNIQUE INDEX "SnmpTrapEnrollment_siteId_sourceAddress_key" ON "SnmpTrapEnrollment"("siteId", "sourceAddress");
ALTER TABLE "SnmpTrapEnrollment" ADD CONSTRAINT "SnmpTrapEnrollment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnmpTrapEvent" ADD COLUMN "enrollmentId" UUID;
CREATE INDEX "SnmpTrapEvent_enrollmentId_receivedAt_idx" ON "SnmpTrapEvent"("enrollmentId", "receivedAt");
ALTER TABLE "SnmpTrapEvent" ADD CONSTRAINT "SnmpTrapEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "SnmpTrapEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
