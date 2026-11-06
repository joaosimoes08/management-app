CREATE TABLE "LinuxAgent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hostId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "observedHostname" TEXT,
    "observedOs" TEXT,
    "observedOsVersion" TEXT,
    "agentVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LinuxAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinuxAgent_hostId_key" ON "LinuxAgent"("hostId");
CREATE UNIQUE INDEX "LinuxAgent_tokenHash_key" ON "LinuxAgent"("tokenHash");
CREATE INDEX "LinuxAgent_revokedAt_lastHeartbeatAt_idx" ON "LinuxAgent"("revokedAt", "lastHeartbeatAt");
ALTER TABLE "LinuxAgent" ADD CONSTRAINT "LinuxAgent_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
