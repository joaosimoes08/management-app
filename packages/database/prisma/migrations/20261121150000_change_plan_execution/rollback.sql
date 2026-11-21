-- Manual rollback for 20261121150000_change_plan_execution.
-- Postgres cannot drop enum values; plans in the new states are moved back to APPROVED first,
-- and the enum keeps the unused values (harmless to older code paths that never select them).
UPDATE "ChangePlan" SET "status" = 'APPROVED' WHERE "status" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK');
ALTER TABLE "SnmpWriteRequest" DROP CONSTRAINT IF EXISTS "SnmpWriteRequest_changePlanId_fkey";
DROP INDEX IF EXISTS "SnmpWriteRequest_changePlanId_idx";
ALTER TABLE "SnmpWriteRequest" DROP COLUMN IF EXISTS "changePlanId";
DROP TABLE IF EXISTS "ChangePlanChecklistItem";
ALTER TABLE "ChangePlan" DROP CONSTRAINT IF EXISTS "ChangePlan_startedById_fkey";
ALTER TABLE "ChangePlan" DROP CONSTRAINT IF EXISTS "ChangePlan_closedById_fkey";
ALTER TABLE "ChangePlan" DROP COLUMN IF EXISTS "startedAt", DROP COLUMN IF EXISTS "startedById", DROP COLUMN IF EXISTS "closedAt", DROP COLUMN IF EXISTS "closedById", DROP COLUMN IF EXISTS "closingNote";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261121150000_change_plan_execution';
