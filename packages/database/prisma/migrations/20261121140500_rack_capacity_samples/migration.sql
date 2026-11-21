CREATE TABLE "RackCapacitySample" (
    "rackId" UUID NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "used" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "RackCapacitySample_pkey" PRIMARY KEY ("rackId", "resourceKey", "sampledAt"),
    CONSTRAINT "RackCapacitySample_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RackCapacitySample_sampledAt_idx" ON "RackCapacitySample"("sampledAt");
