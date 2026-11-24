-- Additive: newest sighting per device for the SNMP endpoint lookup (one backward index probe per device).
-- CreateIndex
CREATE INDEX "SnmpArpEntry_deviceId_lastSeenAt_idx" ON "SnmpArpEntry"("deviceId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "SnmpMacEntry_deviceId_lastSeenAt_idx" ON "SnmpMacEntry"("deviceId", "lastSeenAt");
