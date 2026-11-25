#!/usr/bin/env bash
# SNMP trap lab: build, start, run the packet -> alert cases, tear down.
# Usage: pnpm test:snmp-lab   (SNMPLAB_KEEP=1 keeps the lab running afterwards for debugging)
set -euo pipefail
cd "$(dirname "$0")"
project="${SNMPLAB_PROJECT:-snmplab}"
compose=(docker compose -p "$project" -f docker-compose.yml)

rm -rf .lab && mkdir -p .lab/logs
node ../../scripts/generate-snmp-keyring.mjs .lab/snmp-keyring.json >/dev/null
# Lab-only key; readable by the non-root users inside the api/snmp containers.
chmod 644 .lab/snmp-keyring.json

teardown() {
  local status=$?
  "${compose[@]}" logs --no-color --timestamps > .lab/logs/compose.log 2>&1 || true
  if [[ "${SNMPLAB_KEEP:-0}" != "1" ]]; then "${compose[@]}" down -v --remove-orphans || true; fi
  exit "$status"
}
trap teardown EXIT

"${compose[@]}" up -d --build --wait --wait-timeout 600
"${compose[@]}" exec -T sender node --test --test-reporter=spec /app/e2e/snmp-trap-lab/run.mjs 2>&1 | tee .lab/logs/results.txt
exit "${PIPESTATUS[0]}"
