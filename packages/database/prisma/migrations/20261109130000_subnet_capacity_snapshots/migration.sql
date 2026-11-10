CREATE TABLE "SubnetCapacitySnapshot" (
    "id" UUID NOT NULL,
    "subnetId" UUID NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "usableCapacity" INTEGER,
    "trackedAddresses" INTEGER NOT NULL,
    "occupiedAddresses" INTEGER NOT NULL,
    "reservedAddresses" INTEGER NOT NULL,
    "allocatedAddresses" INTEGER NOT NULL,
    "freeAddresses" INTEGER,
    "utilizationPercent" DOUBLE PRECISION,

    CONSTRAINT "SubnetCapacitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubnetCapacitySnapshot_subnetId_sampledAt_key" ON "SubnetCapacitySnapshot"("subnetId", "sampledAt");

ALTER TABLE "SubnetCapacitySnapshot" ADD CONSTRAINT "SubnetCapacitySnapshot_subnetId_fkey" FOREIGN KEY ("subnetId") REFERENCES "Subnet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
