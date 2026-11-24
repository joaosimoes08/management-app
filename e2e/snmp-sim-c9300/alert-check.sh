#!/usr/bin/env bash
# SNMP Phase 2 step 9: compose up -> health alert check (degraded raises, healthy resolves) against the simulated C9300 -> compose down.
# LAB-ONLY simulator. Needs DATABASE_URL pointing at an isolated, migrated database whose name ends in _test.
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
cd "$root/apps/api"
SNMP_SIM_C9300=1 TS_NODE_TRANSPILE_ONLY=true node --test -r ts-node/register test/health-alerts.sim.spec.ts
