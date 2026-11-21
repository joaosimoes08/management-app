-- Run after rolling back the API. Removes the Teams channel settings (including the stored webhook secrets), opt-ins and the delivery log.
DROP TABLE "NotificationDelivery";
DROP TABLE "NotificationChannelPreference";
DROP TABLE "DeliveryChannelConfig";
DROP TYPE "NotificationDeliveryStatus";
DROP TYPE "DeliveryTarget";
DROP TYPE "DeliveryChannelKind";
