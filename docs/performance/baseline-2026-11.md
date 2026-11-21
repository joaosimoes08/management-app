---
title: Step 18 baseline (Management-App, measure only)
---

# Step 18 — performance baseline (2026-11-21)

**Status: partial.** Measured: API timings, request/payload sizes, SQL counts, DB top queries, EXPLAIN for the 10 slowest SELECTs, and AuditLog growth. Not measured: the ⌘K cached-vs-excluded A/B block, the second pass of `global-search-miss`, and **all browser metrics**. Measurement only: no app code, no fixes, no visible change.

## Method

- Dataset: local `mgmtapp_perf` copy (isolated, loopback only). Counts in `raw/dataset-counts.csv`: Site 3, Rack 7, Device 7, IpAddress 3, Subnet 5, AuditLog 7,671,484, ChangePlan 1, TopologyMap 3, others 0.
- Production build: API via `scripts/performance/server.cjs` (NODE_ENV=production, loopback 4001); web via `next start` (4002) behind `scripts/performance/web-proxy.mjs` (4000); isolated Keycloak (4080) and token helper (4081).
- Command: `npm run perf:baseline` (`node scripts/performance/baseline.mjs`). Per endpoint: 2 passes, each with 50 sequential and 10 concurrent requests.
- Cells: median / p95 in ms over the 60 samples of a pass. Bytes: raw / gzip-equivalent, median.
- The SNMP endpoints use a network device (SWITCH/FIREWALL). The first run picked a SERVER and returned 400 for every request, so `fixture.mjs` now prefers a network device, and the two SNMP endpoints were re-run (separately, merged into `raw/api-raw.csv`).

## API latency and payload

| Endpoint | Pass 1 median / p95 (ms) | Pass 2 median / p95 (ms) | Bytes raw / gzip (pass 1) | SQL per request |
|---|---|---|---|---|
| `attestation` | 10.9 / 25.0 | 9.0 / 20.9 | 111 / 121 | 13 |
| `audit-facets` | 122.0 / 874.0 | 130.6 / 832.6 | 2122 / 709 | 11 |
| `audit-page` | 8.3 / 19.6 | 7.7 / 17.5 | 21610 / 1903 | 9 |
| `change-detail` | 19.1 / 54.6 | 17.7 / 46.0 | 135346 / 10227 | 28 |
| `changes-list` | 21.1 / 76.6 | 17.7 / 60.3 | 135348 / 10230 | 28 |
| `changes-summary` | 8.4 / 24.3 | 7.8 / 20.7 | 205 / 184 | 12 |
| `dashboard-ops` | 17.0 / 56.5 | 100.9 / 222.2 | 643 / 363 | 39 |
| `dashboard-summary` | 11.7 / 34.2 | 127.1 / 295.0 | 1373 / 469 | 20 |
| `devices` | 12.7 / 45.8 | 13.5 / 32.5 | 33343 / 4531 | 19 |
| `ipam-history` | 10.1 / 24.7 | 9.6 / 24.3 | 2933 / 565 | 13 |
| `ipam-ips` | 9.2 / 23.2 | 9.2 / 24.4 | 1205 / 611 | 12 |
| `ipam-subnets` | 9.4 / 23.5 | 8.7 / 23.0 | 3107 / 812 | 13 |
| `ipam-usage` | 8.9 / 30.6 | 9.2 / 21.0 | 648 / 426 | 11 |
| `profile-identity` | 7.3 / 17.7 | 60.7 / 139.9 | 136 / 139 | 7 |
| `quality-facets` | 7.3 / 17.2 | 7.5 / 18.0 | 179 / 153 | 10 |
| `quality-findings` | 7.5 / 16.0 | 7.8 / 15.0 | 46 / 59 | 9 |
| `rack-detail` | 12.2 / 28.2 | 13.5 / 30.1 | 12930 / 2614 | 20 |
| `rack-list` | 11.4 / 47.0 | 15.0 / 36.7 | 12932 / 2616 | 18 |
| `rack-power` | 12.1 / 28.9 | 10.7 / 26.3 | 1176 / 586 | 18 |
| `setup-status` | 7.1 / 15.7 | 57.4 / 150.5 | 152 / 140 | 9 |
| `sites` | 9.1 / 41.5 | 47.6 / 119.8 | 988 / 440 | 9 |
| `snmp-device` | 10.9 / 52.0 | 17.6 / 41.2 | 106 / 100 | 19 |
| `snmp-fleet` | 9.4 / 19.5 | 10.6 / 22.9 | 400 / 281 | 12 |
| `snmp-metrics` | 10.6 / 29.9 | 10.8 / 22.8 | 128 / 109 | 17 |
| `topbar` | 11.5 / 35.5 | 108.5 / 361.8 | 1146 / 537 | 20 |
| `topology-detail` | 16.7 / 43.1 | 15.6 / 41.7 | 22695 / 4219 | 28 |
| `topology-list` | 9.2 / 19.9 | 9.0 / 25.8 | 1098 / 462 | 12 |

## ⌘K global search (`/dashboard/search`)

| Endpoint | Pass 1 median / p95 (ms) | Pass 2 median / p95 (ms) | Bytes raw / gzip | SQL per request |
|---|---|---|---|---|
| `global-search-api` | 12.9 / 51.4 | 13.9 / 41.4 | 6899 / 726 | 24 |
| `global-search-miss` | 4827.3 / 24655.7 | not captured / not captured | 7211 / 742 | 37 |

The "miss" query (no match) is the slow case: median 4.8 s and p95 24.7 s in pass 1, matching the roadmap's "> 4 s (observed)". The "api" term takes about 13 ms.

## Repeat-run check (acceptance: ≤10 % at median)

These endpoints differ by more than 10 % between the two passes, so they fail the acceptance criterion and need a cause before Step 19:

- `attestation` 10.9 → 9.0 ms (17%)
- `changes-list` 21.1 → 17.7 ms (16%)
- `dashboard-ops` 17.0 → 100.9 ms (83%)
- `dashboard-summary` 11.7 → 127.1 ms (91%)
- `profile-identity` 7.3 → 60.7 ms (88%)
- `rack-list` 11.4 → 15.0 ms (24%)
- `rack-power` 12.1 → 10.7 ms (12%)
- `setup-status` 7.1 → 57.4 ms (88%)
- `sites` 9.1 → 47.6 ms (81%)
- `snmp-device` 10.9 → 17.6 ms (38%)
- `snmp-fleet` 9.4 → 10.6 ms (11%)
- `topbar` 11.5 → 108.5 ms (89%)

Some of these are fast endpoints, where a few ms of noise is a large percentage. The large jumps (for example `topbar` 11.5 → 108.5 ms, `dashboard-summary` 11.7 → 127.1 ms, `sites` 9.1 → 47.6 ms) are not explained yet. Candidates: a warm-up effect in pass 1, or background AuditLog writes from the HTTP audit interceptor during the run. Re-run before locking the baseline.

## DB (top queries by total time, `raw/db-top20.csv`)

- AuditLog reads dominate: one `SELECT AuditLog` shape took 576 s in total over 200 calls (max 30.1 s).
- Writes that scale with page views: `INSERT AuditLog` 3,201 and 3,442 calls (7.4 s and 5.2 s); `UPDATE User` 4.0 s; `DELETE UserRole` 1.7 s; `INSERT UserRole` 1.5 s.
- `EXPLAIN (ANALYZE, BUFFERS)` for the 10 slowest SELECTs is in `raw/db-explain.json`. The slowest AuditLog plan reads about 503k shared-hit and 13k shared-read blocks (about 112 ms) through Gather Merge and Sort.

## AuditLog growth (`raw/audit-growth.csv`, hours from 2026-11-20 14:00 UTC)

Rows per hour are dominated by test traffic, not normal use. Bursts of up to 300,674 rows per hour, mostly HTTP_REQUEST rows, show that every page view writes an audit row. "Normal use" per hour still needs a real usage window.

## Not measured yet

1. **⌘K cached-vs-excluded A/B** (`search-ab`) did not run to completion. The rate limit (95 search requests per 61 s) paced the run, and the second pass of `global-search-miss` stalled. Re-run after the search endpoints have cooled down.
2. **Browser metrics** (TTFB, LCP, time-to-data, JS/total bytes, request counts; 5 runs cold and warm per page) are not measured. The probe wiring exists (`web-proxy.mjs`, `browser-probe.js`), but only a discarded smoke sample exists, so it is not shipped.
3. **Keycloak and latency breakdown** (Server-Timing): only `auth_ms` in the raw file.

## Files

- `raw/api-raw.csv`: every API request (run, group, mode, endpoint, status, timings, bytes, SQL count).
- `raw/api-summary.csv`: per endpoint and run, median and p95.
- `raw/db-top20.csv`, `raw/db-explain.json`, `raw/audit-growth.csv`, `raw/dataset-counts.csv`.
- Harness: `scripts/performance/` (`npm run perf:baseline`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
