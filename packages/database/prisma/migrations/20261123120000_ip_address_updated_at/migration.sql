-- Round 2 #6/#14: IP drift rules compare an address with discovery scans that ran after its last change.
-- Additive: existing rows start at the migration time, so no drift is reported for them until the next scan.
ALTER TABLE "IpAddress" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
