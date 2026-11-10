ALTER TABLE "SnmpWriteRequest"
ADD COLUMN "impactPreview" JSONB,
ADD COLUMN "previewAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN "previewAcknowledgedBy" UUID;
