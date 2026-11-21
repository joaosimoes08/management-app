-- Step 30: change plan implementation and close-out.
-- Independent of 20261121140000_notification_centre (#92) and 20261121140500_rack_capacity_samples (#93):
-- touches only ChangePlan, the new ChangePlanChecklistItem table and SnmpWriteRequest.changePlanId.
ALTER TYPE "ChangePlanStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "ChangePlanStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "ChangePlanStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "ChangePlanStatus" ADD VALUE IF NOT EXISTS 'ROLLED_BACK';

ALTER TABLE "ChangePlan"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "startedById" UUID,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedById" UUID,
  ADD COLUMN "closingNote" TEXT;

ALTER TABLE "ChangePlan" ADD CONSTRAINT "ChangePlan_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangePlan" ADD CONSTRAINT "ChangePlan_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChangePlanChecklistItem" (
    "id" UUID NOT NULL,
    "changePlanId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangePlanChecklistItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangePlanChecklistItem_changePlanId_position_idx" ON "ChangePlanChecklistItem"("changePlanId", "position");
ALTER TABLE "ChangePlanChecklistItem" ADD CONSTRAINT "ChangePlanChecklistItem_changePlanId_fkey" FOREIGN KEY ("changePlanId") REFERENCES "ChangePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangePlanChecklistItem" ADD CONSTRAINT "ChangePlanChecklistItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangePlanChecklistItem" ADD CONSTRAINT "ChangePlanChecklistItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SnmpWriteRequest" ADD COLUMN "changePlanId" UUID;
CREATE INDEX "SnmpWriteRequest_changePlanId_idx" ON "SnmpWriteRequest"("changePlanId");
ALTER TABLE "SnmpWriteRequest" ADD CONSTRAINT "SnmpWriteRequest_changePlanId_fkey" FOREIGN KEY ("changePlanId") REFERENCES "ChangePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
