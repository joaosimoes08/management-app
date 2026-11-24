#!/usr/bin/env bash
# SNMP Phase 2 step 8: compose up -> health polling spec against the simulated C9300 (v2c + v3) -> compose down.
# LAB-ONLY simulator; uses only the snmp-sim-c9300 compose project.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
compose=(docker compose -f "$root/e2e/snmp-sim-c9300/docker-compose.yml")
trap '"${compose[@]}" down' EXIT
"${compose[@]}" up -d --build
for _ in $(seq 1 30); do
  node "$root/e2e/snmp-sim-c9300/walk-check.mjs" >/dev/null 2>&1 && break
  sleep 1
done
cd "$root/apps/snmp"
SNMP_SIM_C9300=1 TS_NODE_TRANSPILE_ONLY=true node --test -r ts-node/register src/device-health.sim.spec.ts
