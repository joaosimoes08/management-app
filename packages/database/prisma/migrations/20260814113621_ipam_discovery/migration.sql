-- CreateEnum
CREATE TYPE "DiscoveryJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscoveryResultStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

-- CreateTable
CREATE TABLE "DiscoveryJob" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subnetId" UUID NOT NULL,
    "methods" JSONB NOT NULL,
    "tcpPorts" JSONB,
    "status" "DiscoveryJobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryResult" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "hostname" TEXT,
    "icmpReachable" BOOLEAN NOT NULL DEFAULT false,
    "responseMs" INTEGER,
    "openPorts" JSONB,
    "status" "DiscoveryResultStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryJob_subnetId_createdAt_idx" ON "DiscoveryJob"("subnetId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryResult_status_createdAt_idx" ON "DiscoveryResult"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryResult_jobId_address_key" ON "DiscoveryResult"("jobId", "address");

-- AddForeignKey
ALTER TABLE "DiscoveryJob" ADD CONSTRAINT "DiscoveryJob_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryResult" ADD CONSTRAINT "DiscoveryResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DiscoveryJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
