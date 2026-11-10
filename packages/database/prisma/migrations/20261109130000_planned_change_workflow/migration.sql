CREATE TYPE "ChangePlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ChangeEntityType" AS ENUM ('DEVICE', 'INTERFACE', 'VLAN', 'SUBNET', 'IP_ADDRESS', 'HOST', 'SERVICE');

CREATE TABLE "ChangePlan" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "plannedStartAt" TIMESTAMP(3) NOT NULL,
    "plannedEndAt" TIMESTAMP(3) NOT NULL,
    "status" "ChangePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "previewRevision" INTEGER,
    "previewSnapshot" JSONB,
    "previewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChangePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChangePlanItem" (
    "id" UUID NOT NULL,
    "changePlanId" UUID NOT NULL,
    "entityType" "ChangeEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "operationSummary" TEXT NOT NULL,
    "currentValue" JSONB,
    "proposedValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangePlanItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangePlan_siteId_status_plannedStartAt_idx" ON "ChangePlan"("siteId", "status", "plannedStartAt");
CREATE INDEX "ChangePlan_createdById_createdAt_idx" ON "ChangePlan"("createdById", "createdAt");
CREATE UNIQUE INDEX "ChangePlanItem_changePlanId_entityType_entityId_key" ON "ChangePlanItem"("changePlanId", "entityType", "entityId");
CREATE INDEX "ChangePlanItem_entityType_entityId_idx" ON "ChangePlanItem"("entityType", "entityId");

ALTER TABLE "ChangePlan" ADD CONSTRAINT "ChangePlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangePlan" ADD CONSTRAINT "ChangePlan_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangePlan" ADD CONSTRAINT "ChangePlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangePlanItem" ADD CONSTRAINT "ChangePlanItem_changePlanId_fkey" FOREIGN KEY ("changePlanId") REFERENCES "ChangePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
