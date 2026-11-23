-- Discovery P0: per-subnet rate limit and socket cap for discovery scans. Additive and nullable:
-- NULL means the worker default (DISCOVERY_DEFAULT_PROBES_PER_SECOND / DISCOVERY_DEFAULT_MAX_SOCKETS).
ALTER TABLE "Subnet"
  ADD COLUMN "discoveryProbesPerSecond" INTEGER,
  ADD COLUMN "discoveryMaxSockets" INTEGER;

ALTER TABLE "Subnet"
  ADD CONSTRAINT "Subnet_discoveryProbesPerSecond_range" CHECK ("discoveryProbesPerSecond" IS NULL OR "discoveryProbesPerSecond" BETWEEN 1 AND 2000),
  ADD CONSTRAINT "Subnet_discoveryMaxSockets_range" CHECK ("discoveryMaxSockets" IS NULL OR "discoveryMaxSockets" BETWEEN 1 AND 1024);
