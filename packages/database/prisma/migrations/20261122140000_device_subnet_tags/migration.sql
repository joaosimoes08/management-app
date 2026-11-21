-- Step 36: site-scoped tags for devices and subnets. New tables only; nothing existing changes. Reversal: down.sql.

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceTag" (
    "deviceId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceTag_pkey" PRIMARY KEY ("deviceId","tagId")
);

-- CreateTable
CREATE TABLE "SubnetTag" (
    "subnetId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubnetTag_pkey" PRIMARY KEY ("subnetId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_siteId_name_key" ON "Tag"("siteId", "name");

-- CreateIndex
CREATE INDEX "DeviceTag_tagId_idx" ON "DeviceTag"("tagId");

-- CreateIndex
CREATE INDEX "SubnetTag_tagId_idx" ON "SubnetTag"("tagId");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTag" ADD CONSTRAINT "DeviceTag_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTag" ADD CONSTRAINT "DeviceTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubnetTag" ADD CONSTRAINT "SubnetTag_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubnetTag" ADD CONSTRAINT "SubnetTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

