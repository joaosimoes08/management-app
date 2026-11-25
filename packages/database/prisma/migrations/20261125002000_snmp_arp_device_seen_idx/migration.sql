-- Additive: newest ARP sighting per device for the SNMP endpoint lookup (one backward index probe per device).
-- CONCURRENTLY so the SNMP worker keeps writing while the index builds. It cannot run inside a transaction,
-- so this file holds exactly one statement (Prisma then sends it on its own, outside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SnmpArpEntry_deviceId_lastSeenAt_idx" ON "SnmpArpEntry"("deviceId", "lastSeenAt");
