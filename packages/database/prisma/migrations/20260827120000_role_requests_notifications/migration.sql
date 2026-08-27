CREATE TYPE "RoleRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED');

CREATE TABLE "RoleRequest" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "roles" "RoleName"[] NOT NULL,
  "status" "RoleRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewerId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "RoleRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RoleRequest_userId_createdAt_idx" ON "RoleRequest"("userId", "createdAt");
CREATE INDEX "RoleRequest_status_createdAt_idx" ON "RoleRequest"("status", "createdAt");
CREATE UNIQUE INDEX "RoleRequest_one_pending_per_user" ON "RoleRequest"("userId") WHERE "status" IN ('PENDING', 'PROCESSING');
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleRequest" ADD CONSTRAINT "RoleRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "roleRequestId" UUID,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_roleRequestId_fkey" FOREIGN KEY ("roleRequestId") REFERENCES "RoleRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
