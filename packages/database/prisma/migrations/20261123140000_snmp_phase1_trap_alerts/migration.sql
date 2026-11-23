-- SNMP Phase 1 (additive): device-unreachable counter, rejected-trap status, per-install SNMPv3 engine ID.
ALTER TABLE "SnmpDeviceConfig" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "SnmpTrapStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "SnmpListenerConfig" ADD COLUMN "engineId" TEXT;

-- Phase 1 review: rejected SNMPv1 traps are stored with their real version. Credentials stay V2C/V3 (API validation).
ALTER TYPE "SnmpVersion" ADD VALUE IF NOT EXISTS 'V1';

-- Phase 1 re-review: the engine ID the receiver actually uses (env override included), so the API reports the receiver's truth.
ALTER TABLE "SnmpListenerConfig" ADD COLUMN "activeEngineId" TEXT;
ALTER TABLE "SnmpListenerConfig" ADD COLUMN "activeEngineIdSource" TEXT;
