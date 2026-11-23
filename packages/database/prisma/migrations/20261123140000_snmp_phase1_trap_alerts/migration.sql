-- SNMP Phase 1 (additive): device-unreachable counter, rejected-trap status, per-install SNMPv3 engine ID.
ALTER TABLE "SnmpDeviceConfig" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "SnmpTrapStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "SnmpListenerConfig" ADD COLUMN "engineId" TEXT;
