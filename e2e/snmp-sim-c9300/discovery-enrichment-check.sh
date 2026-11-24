#!/usr/bin/env bash
# D-P1a: compose up -> discovery SNMP enrichment spec against the simulated C9300 (v2c + v3) -> compose down.
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
cd "$root/apps/api"
SNMP_SIM_C9300=1 TS_NODE_TRANSPILE_ONLY=true node --test -r ts-node/register src/discovery/discovery-snmp.sim.spec.ts
