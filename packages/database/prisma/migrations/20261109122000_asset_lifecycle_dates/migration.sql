CREATE TABLE "LifecycleDate" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "reminderDays" JSONB NOT NULL DEFAULT '[30,7,0]',
    "responsibleUserId" UUID,
    "responsibleGroupId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LifecycleDate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LifecycleReminderDelivery" (
    "id" UUID NOT NULL,
    "lifecycleDateId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "reminderDays" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifecycleReminderDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LifecycleDate_deviceId_kind_key" ON "LifecycleDate"("deviceId", "kind");
CREATE INDEX "LifecycleDate_dueDate_kind_idx" ON "LifecycleDate"("dueDate", "kind");
CREATE INDEX "LifecycleDate_responsibleGroupId_idx" ON "LifecycleDate"("responsibleGroupId");
CREATE INDEX "LifecycleDate_responsibleUserId_idx" ON "LifecycleDate"("responsibleUserId");
CREATE UNIQUE INDEX "LifecycleReminderDelivery_lifecycleDateId_recipientUserId_r_key" ON "LifecycleReminderDelivery"("lifecycleDateId", "recipientUserId", "reminderDays", "dueDate");
CREATE INDEX "LifecycleReminderDelivery_deliveredAt_idx" ON "LifecycleReminderDelivery"("deliveredAt");

ALTER TABLE "LifecycleDate" ADD CONSTRAINT "LifecycleDate_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifecycleDate" ADD CONSTRAINT "LifecycleDate_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LifecycleDate" ADD CONSTRAINT "LifecycleDate_responsibleGroupId_fkey" FOREIGN KEY ("responsibleGroupId") REFERENCES "AccessGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LifecycleReminderDelivery" ADD CONSTRAINT "LifecycleReminderDelivery_lifecycleDateId_fkey" FOREIGN KEY ("lifecycleDateId") REFERENCES "LifecycleDate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifecycleReminderDelivery" ADD CONSTRAINT "LifecycleReminderDelivery_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
