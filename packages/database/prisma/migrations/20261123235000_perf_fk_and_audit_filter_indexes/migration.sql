-- Additive only: indexes for the audit actor/action filters and for foreign keys
-- that list and inventory queries join or filter on. No drops, renames or data changes.

-- AuditLog: actor and action filters ordered by newest first (keeps the page fast under
-- Prisma's generic prepared-statement plans, where the non-HTTP partial index can't be used).
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_id_idx" ON "AuditLog"("userId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_id_idx" ON "AuditLog"("action", "createdAt" DESC, "id" DESC);

-- Foreign keys without a leading index.
CREATE INDEX IF NOT EXISTS "IpAddress_deviceId_idx" ON "IpAddress"("deviceId");
CREATE INDEX IF NOT EXISTS "IpAddress_interfaceId_idx" ON "IpAddress"("interfaceId");
CREATE INDEX IF NOT EXISTS "Device_rackId_idx" ON "Device"("rackId");
CREATE INDEX IF NOT EXISTS "Subnet_parentSubnetId_idx" ON "Subnet"("parentSubnetId");
CREATE INDEX IF NOT EXISTS "DeviceConnection_sourceInterfaceId_idx" ON "DeviceConnection"("sourceInterfaceId");
CREATE INDEX IF NOT EXISTS "DeviceConnection_targetInterfaceId_idx" ON "DeviceConnection"("targetInterfaceId");
