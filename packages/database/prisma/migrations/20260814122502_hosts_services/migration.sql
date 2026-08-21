-- AlterTable
ALTER TABLE "IpAddress" ADD COLUMN     "hostId" UUID;

-- CreateTable
CREATE TABLE "Host" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "operatingSystem" TEXT,
    "macAddress" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT,
    "port" INTEGER,
    "status" TEXT,
    "version" TEXT,
    "hostId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Host_name_key" ON "Host"("name");

-- CreateIndex
CREATE INDEX "Host_hostname_idx" ON "Host"("hostname");

-- CreateIndex
CREATE INDEX "Service_name_status_idx" ON "Service"("name", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Service_hostId_protocol_port_key" ON "Service"("hostId", "protocol", "port");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAddress" ADD CONSTRAINT "IpAddress_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
