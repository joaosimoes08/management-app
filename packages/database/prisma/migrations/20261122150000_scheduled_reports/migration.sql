-- Step 32: scheduled reports (weekly/monthly digest per Site). Definitions, recipients with unsubscribe tokens, runs and per-recipient outputs; e-mail deliveries reference the output that holds the HTML body and CSV attachment.
-- CreateEnum
CREATE TYPE "ScheduledReportFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "reportOutputId" UUID;

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "ScheduledReportFrequency" NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "hour" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "sections" TEXT[],
    "siteIds" UUID[],
    "sendEmail" BOOLEAN NOT NULL DEFAULT true,
    "sendTeams" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReportRecipient" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "unsubscribeToken" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReportRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReportRun" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReportOutput" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "userId" UUID,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "csv" TEXT NOT NULL,
    "siteCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReportOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledReport_enabled_nextRunAt_idx" ON "ScheduledReport"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledReportRecipient_unsubscribeToken_key" ON "ScheduledReportRecipient"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "ScheduledReportRecipient_userId_idx" ON "ScheduledReportRecipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledReportRecipient_reportId_userId_key" ON "ScheduledReportRecipient"("reportId", "userId");

-- CreateIndex
CREATE INDEX "ScheduledReportRun_reportId_createdAt_idx" ON "ScheduledReportRun"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledReportRun_createdAt_idx" ON "ScheduledReportRun"("createdAt");

-- CreateIndex
CREATE INDEX "ScheduledReportOutput_runId_idx" ON "ScheduledReportOutput"("runId");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_reportOutputId_fkey" FOREIGN KEY ("reportOutputId") REFERENCES "ScheduledReportOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReportRecipient" ADD CONSTRAINT "ScheduledReportRecipient_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ScheduledReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReportRecipient" ADD CONSTRAINT "ScheduledReportRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReportRun" ADD CONSTRAINT "ScheduledReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ScheduledReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReportOutput" ADD CONSTRAINT "ScheduledReportOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScheduledReportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReportOutput" ADD CONSTRAINT "ScheduledReportOutput_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

