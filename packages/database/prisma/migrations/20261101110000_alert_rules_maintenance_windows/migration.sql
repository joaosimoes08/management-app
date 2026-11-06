CREATE TABLE "AlertRule" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "siteId" UUID,
  "minSeverity" TEXT NOT NULL DEFAULT 'WARNING',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AlertRule_siteId_source_enabled_idx" ON "AlertRule"("siteId", "source", "enabled");
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MaintenanceWindow" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "reason" TEXT,
  "siteId" UUID,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MaintenanceWindow_siteId_startsAt_endsAt_idx" ON "MaintenanceWindow"("siteId", "startsAt", "endsAt");
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
