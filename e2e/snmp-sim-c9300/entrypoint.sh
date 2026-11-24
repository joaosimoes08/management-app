#!/bin/sh
# Picks one variant (healthy | degraded | nolldp) and serves it over SNMPv2c and SNMPv3 authPriv (SHA / AES-128).
# All credentials are lab-only test values, overridable through the environment.
set -eu
variant="${SIM_VARIANT:?set SIM_VARIANT to healthy, degraded or nolldp}"
src="/usr/local/snmpsim/variants/c9300-${variant}.snmprec"
[ -f "$src" ] || { echo "unknown SIM_VARIANT '${variant}'" >&2; exit 1; }
community="${SIM_COMMUNITY:-lab-public}"
data=/tmp/snmpsim-data
rm -rf "$data" && mkdir -p "$data/self"
# SNMPv2c: snmpsim picks the data file whose name is the community.
cp "$src" "$data/${community}.snmprec"
# SNMPv3 with an empty context name (what the app's poller sends): snmpsim probes "self/<transport domain>",
# 1.3.6.1.6.1.1.0 being UDP/IPv4. Requests with context "<community>" also work.
cp "$src" "$data/self/1.3.6.1.6.1.1.0.snmprec"
exec snmpsim-command-responder \
  --data-dir="$data" --cache-dir=/tmp/snmpsim-cache \
  --agent-udpv4-endpoint=0.0.0.0:1161 \
  --v3-user="${SIM_V3_USER:-labpoll}" \
  --v3-auth-key="${SIM_V3_AUTH_KEY:-lab-poll-auth-pass}" --v3-auth-proto=SHA \
  --v3-priv-key="${SIM_V3_PRIV_KEY:-lab-poll-priv-pass}" --v3-priv-proto=AES
