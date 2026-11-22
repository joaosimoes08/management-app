-- Step 31: Microsoft Teams and Email (SMTP) delivery channels, per-user channel opt-in, delivery log. All channels start disabled.
-- CreateEnum
CREATE TYPE "DeliveryChannelKind" AS ENUM ('TEAMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryTarget" AS ENUM ('USER_NOTIFICATIONS', 'GROUP_ALERTS');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "DeliveryChannelConfig" (
    "id" UUID NOT NULL,
    "kind" "DeliveryChannelKind" NOT NULL,
    "target" "DeliveryTarget" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minSeverity" "OperationalAlertSeverity",
    "settings" JSONB,
    "ciphertext" BYTEA,
    "iv" BYTEA,
    "authTag" BYTEA,
    "wrappedDek" BYTEA,
    "wrapIv" BYTEA,
    "wrapAuthTag" BYTEA,
    "keyId" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannelPreference" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "DeliveryChannelKind" NOT NULL,

    CONSTRAINT "NotificationChannelPreference_pkey" PRIMARY KEY ("userId","type","channel")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "channel" "DeliveryChannelKind" NOT NULL,
    "target" "DeliveryTarget" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "topic" TEXT NOT NULL,
    "recipientUserId" UUID,
    "alertId" UUID,
    "dedupKey" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "href" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "requestedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryChannelConfig_kind_target_key" ON "DeliveryChannelConfig"("kind", "target");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_dedupKey_key" ON "NotificationDelivery"("dedupKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_createdAt_id_idx" ON "NotificationDelivery"("createdAt", "id");

-- AddForeignKey
ALTER TABLE "NotificationChannelPreference" ADD CONSTRAINT "NotificationChannelPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

