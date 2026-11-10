CREATE TABLE "IpReservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ipAddressId" UUID NOT NULL,
  "createdById" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IpReservation_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "IpAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IpReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "IpReservation_status_expiresAt_idx" ON "IpReservation"("status", "expiresAt");
CREATE INDEX "IpReservation_ipAddressId_status_idx" ON "IpReservation"("ipAddressId", "status");
