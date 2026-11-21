-- Run after rolling back the API. Removes report definitions, recipients (and their unsubscribe choices), runs and generated outputs. The delivery log keeps its rows without the report link.
ALTER TABLE "NotificationDelivery" DROP CONSTRAINT "NotificationDelivery_reportOutputId_fkey";
ALTER TABLE "NotificationDelivery" DROP COLUMN "reportOutputId";
DROP TABLE "ScheduledReportOutput";
DROP TABLE "ScheduledReportRun";
DROP TABLE "ScheduledReportRecipient";
DROP TABLE "ScheduledReport";
DROP TYPE "ScheduledReportFrequency";
