-- AlterTable
ALTER TABLE "DiscoveryJob" ADD COLUMN     "outcomeCounts" JSONB;

-- AlterTable
ALTER TABLE "DiscoveryResult" ADD COLUMN     "outcome" JSONB;

