ALTER TABLE "SystemSettings"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'pt-PT',
  ADD COLUMN "discoveryDefaultMethods" JSONB NOT NULL DEFAULT '["ICMP","TCP"]',
  ADD COLUMN "discoveryDefaultTcpPorts" JSONB NOT NULL DEFAULT '[22,80,443,3389]',
  ADD COLUMN "discoveryDefaultReverseDns" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "discoveryDefaultIntervalHours" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "auditRetentionDays" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "lastAuditCleanupAt" TIMESTAMP(3),
  ADD COLUMN "lastAuditCleanupDeletedCount" INTEGER;

ALTER TABLE "DiscoverySchedule"
  ADD COLUMN "reverseDns" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "DiscoveryJob"
  ADD COLUMN "reverseDns" BOOLEAN NOT NULL DEFAULT true;
