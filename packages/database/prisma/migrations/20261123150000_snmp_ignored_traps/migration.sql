-- SNMP Phase 1 step 4.3 (additive): an admin can ignore unmatched traps from an unknown source.
ALTER TYPE "SnmpTrapStatus" ADD VALUE IF NOT EXISTS 'IGNORED';
