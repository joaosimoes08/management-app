-- Run after rolling back the API. Removes notification preferences and source links.
DROP TABLE "NotificationMute";
DROP INDEX "Notification_userId_createdAt_id_idx";
ALTER TABLE "Notification" DROP COLUMN "sourceHref";
