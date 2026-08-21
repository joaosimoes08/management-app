CREATE TABLE "RipeImport" (
  "id" UUID NOT NULL,
  "query" TEXT NOT NULL,
  "queryType" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'RIPESTAT',
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "result" JSONB NOT NULL,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RipeImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RipeImport_status_createdAt_idx" ON "RipeImport"("status", "createdAt");
