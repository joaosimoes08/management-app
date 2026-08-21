-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "region" TEXT;

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" UUID NOT NULL,
    "organizationName" TEXT,
    "organizationCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "setupCompletedAt" TIMESTAMP(3),
    "setupCompletedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);
