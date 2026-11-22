-- Round 2 #18: rack U-space reservations for planned installs (additive).
CREATE TABLE "RackUnitReservation" (
    "id" UUID NOT NULL,
    "rackId" UUID NOT NULL,
    "startUnit" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" UUID,

    CONSTRAINT "RackUnitReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RackUnitReservation_rackId_releasedAt_idx" ON "RackUnitReservation"("rackId", "releasedAt");

ALTER TABLE "RackUnitReservation" ADD CONSTRAINT "RackUnitReservation_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RackUnitReservation" ADD CONSTRAINT "RackUnitReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
