#!/usr/bin/env bash
# SNMP Phase 2 step 11: compose up -> CDP fallback poll check against the LLDP-absent and healthy simulator
# (real poll job, isolated *_test database and Redis) -> compose down. LAB-ONLY simulator.
#   DATABASE_URL=postgresql://…/<name>_test REDIS_URL=redis://… ./e2e/snmp-sim-c9300/cdp-check.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
case "${DATABASE_URL:-}" in *_test|*_test\?*|*-test|*-test\?*) ;; *) echo "DATABASE_URL must point at an isolated *_test database" >&2; exit 2;; esac
compose=(docker compose -f "$root/e2e/snmp-sim-c9300/docker-compose.yml")
trap '"${compose[@]}" down' EXIT
"${compose[@]}" up -d --build
for _ in $(seq 1 30); do
  node "$root/e2e/snmp-sim-c9300/walk-check.mjs" >/dev/null 2>&1 && break
  sleep 1
done
node "$root/e2e/snmp-sim-c9300/walk-check.mjs"
cd "$root/apps/snmp"
SNMP_SIM_C9300=1 TS_NODE_TRANSPILE_ONLY=true node --test -r ts-node/register src/neighbors.sim.spec.ts src/endpoints.sim.spec.ts
