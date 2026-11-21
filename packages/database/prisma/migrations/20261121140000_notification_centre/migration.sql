ALTER TABLE "Notification" ADD COLUMN "sourceHref" TEXT;
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");

CREATE TABLE "NotificationMute" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    CONSTRAINT "NotificationMute_pkey" PRIMARY KEY ("userId", "type"),
    CONSTRAINT "NotificationMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
