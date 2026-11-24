-- SNMP Phase 2 step 11: CDP as an LLDP fallback. Additive only: a new enum and a column with a default,
-- so every existing observation reads as LLDP.
CREATE TYPE "NeighborProtocol" AS ENUM ('LLDP', 'CDP');

ALTER TABLE "LldpObservation" ADD COLUMN "protocol" "NeighborProtocol" NOT NULL DEFAULT 'LLDP';
