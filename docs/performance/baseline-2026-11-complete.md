# Step 18 — complete performance baseline (2026-11-21)

Measure-only. No product code changed. Raw data: `docs/performance/raw/run3/`.

## Dataset

- Recreated `mgmtapp_perf` from a READ-ONLY `pg_dump` (custom format, 201 MB) of `simoes-mgmtapp-postgres-1`. Dump only: no writes, restarts, or config changes to that container or the dev server.
- Restored into our own container `mgmtapp-perf-pg`. Restore log: 0 errors.
- Per-table row counts: `raw/run3/dataset-counts-2026-11-21.csv`. `AuditLog` = 7,768,348 rows.
- Deviation: PostgreSQL 18 (`postgres:18-alpine`), not 16. Reason: that is the image this stack was set up with; the dump restored cleanly.
- Dev DB caveat: Joao's dev database is missing two branch migrations (`20261121150000_change_plan_execution`, `20261122100000_critical_asset_scale_corrections`). Without them, changes/change-plan endpoints return HTTP 500 (`ChangePlan.startedAt` missing). Measurements were taken on a copy with those migrations applied via `prisma migrate deploy`; the dev DB was not touched.

## Method

- Production builds of API and web, run on this Mac: API instrumented on `:4001`, web on `:4002`, proxy `:4000`, isolated Keycloak `:4080` / token helper `:4081`.
- One warm-up pass discarded before measured runs (pass 1 cold was 5–10× slower on trivial endpoints).
- Run3 is the post-migration main run: 3,520 API requests, all HTTP 200.

## Search ⌘K: cached vs excluded (A/B, run3, n=10 each, median)

| Variant | Api-only | Miss (cache-miss query) |
|---|---|---|
| unchanged (cached) | 18.4 ms | 2,675.8 ms |
| `x-perf-variant: exclude-http` | 2,255.2 ms | 355.3 ms |

Second miss pass (pass 2 vs pass 1 of `global-search-miss`): 2,720.6 ms vs 2,697.2 ms (0.9%).

Reading: the cached path is fast for repeat lookups; the excluded path is much slower for api-only lookups but faster on miss requests. Run1 (pre-migration) showed the same direction.

## Repeat-run variance

- Compared pass 1 vs pass 2 within run3 (`raw/run3/variance-pass1-vs-pass2.csv`). 35 endpoints.
- Endpoints over 10%: `sites` (+33%), `setup-status` (+14%), `dashboard-summary` (+15%), `dashboard-ops` (+11%), `ipam-history` (+35%), `audit-page` (+14%), `changes-list` (+21%), `changes-summary` (+20%), `change-detail` (+22%).
- Cause: all nine are under 25 ms. Absolute differences are 1–4 ms, which is scheduler and cache noise, not a regression. Larger endpoints are within 1–9% (`audit-facets` 1.3%, `global-search-miss` 0.9%).
- Status: **over-10% on sub-25 ms endpoints, cause documented, not a product regression.** Not fully within 10% at median for those nine; a longer repeat run would be needed to tighten them.

## Browser metrics (run3, post-migration, 5 cold + 5 warm per key page)

Median LCP (ms), cold / warm, and visible time. Full table in `raw/run3/browser-summary.csv`.

| Page | Cold LCP | Notes |
|---|---|---|
| dashboard | 200 | warm: 2 `auth-unavailable` (see blockers) |
| ipam | 296 | all rendered |
| rack | 240 | all rendered |
| topology | 184 | all rendered |
| audit | 156 | cold 1 timeout, warm 2 timeouts |
| changes | 196 | all rendered |
| quality | 216 | empty state |
| attestation | 220 | empty state; 1 cold + 1 warm timeout |
| snmp | 244 | cold 1 timeout |
| global-search | 608 | cold 2 timeouts; warm 3 timeouts + 2 `auth-unavailable` |

Global-search cold: visible 609.5 ms, search-after-input 365.2 ms.

## Latency breakdown, 5 slowest flows (API medians, run3)

Pass 1 medians (n=50 each, sequential mode). Pass 2 total in brackets.

| Flow | Total | api | auth | db (summed) | SQL count |
|---|---|---|---|---|---|
| global-search miss | 2,697.2 ms [2,720.6] | 2,693.3 | 7.1 | 2,727.9 | 25 |
| audit-facets | 106.8 ms [108.2] | 103.6 | 7.4 | 260.3 | 11 |
| change-detail | 20.1 ms [24.5] | 18.1 | 4.7 | 25.9 | 30 |
| changes-list | 18.9 ms [22.9] | 16.7 | 4.6 | 25.6 | 28 |
| topology-detail | 17.0 ms [15.7] | 14.9 | 4.4 | 18.8 | 28 |

`db` is the sum of query times, so it can exceed wall time when queries overlap. The global-search miss is almost entirely in the API, not in auth or the browser. `audit-facets` has the largest DB share relative to its total. Raw per-request rows: `raw/run3/api-raw.csv`.

## Database hot statements (run3, `db-top20.csv`)

- `SELECT AuditLog`: 386 calls, 540 s total, max 12.6 s. Largest single cost in the run. It dominates the database time; the calling endpoints were not confirmed in this pass.
- `INSERT AuditLog`: 8,636 calls, 24.9 s total.
- `UPDATE User` / `SELECT User`: 7,080 calls each.
- `SELECT Site`: 2,773 calls, 2.4 s.

## Ranked top-10 bottlenecks

Ranked by measured impact in this run. I did not have the Steps 19–23 definitions in this session, so the mapping to those steps is for the reviewer to confirm.

1. `AuditLog` reads, with multi-second maxima (12.6 s, 2.3 s). Largest total DB time.
2. Global-search miss path: 2.7 s median (unchanged) vs 0.36 s (excluded). Biggest flow-level cost.
3. Global-search browser warm samples all failed (3 timeouts, 2 auth-unavailable of 5).
4. Audit page timeouts (cold 1, warm 2) and audit-facets at 108 ms.
5. Attestation timeouts (1 cold, 1 warm) and empty-state pages (quality, attestation) hide real latency.
6. Cold-start penalty: pass 1 is 5–10× slower on trivial endpoints. Warm-up is required.
7. Rate limiter returning HTTP 429 on `/api/v1/dashboard/topbar-state` under probe load.
8. `AuditLog` inserts: 8,636 inserts, 24.9 s total.
9. Cached ⌘K path: api-only is fast (18 ms) but the excluded path is 2.3 s on the same query. The cache coverage gap needs work.
10. Sub-25 ms endpoints have 1–4 ms noise; the 10% variance target is hard at this scale. Need longer repeats.

## Known blockers and risks

- Warm `auth-unavailable` on dashboard and global-search: the probe reports signed-out, and a CORS error appears on `localhost:4080/realms/COCiber/account` from `:4000`.
- HTTP 429 on topbar-state during browser probes.
- Dev DB missing two branch migrations (see Dataset).
- Browser variance not repeated. The 100-sample run is a single pass.

## Not done in this pass

- Attributing the hot `AuditLog` statements to specific endpoints (the plan capture did not map statements to callers).
- Repeat browser run to confirm browser variance.
- Mapping of the top-10 to Steps 19–23.
