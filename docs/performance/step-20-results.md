# Step 20 results: AuditLog query/index fixes and global-search miss reduction

Measured with the Step 18 harness (`scripts/performance/baseline.mjs`) against a local copy of the production-like dataset on PostgreSQL 18: 7.68M AuditLog rows, 7,586,219 of them `HTTP_REQUEST`. Local API with local identity. Not measured on Joao's production stack.

Raw outputs: `raw/step-20/` (`api-summary-before.csv`, `api-summary-after.csv`, `api-raw-*.csv`, `dataset-counts.csv`).

## Changes

- `dashboard.service.ts`: AUDIT_EVENT search now runs as raw SQL with a literal `entityType <> 'HTTP_REQUEST'` predicate. The previous Prisma filter `action: { not: 'HTTP_REQUEST' }` never excluded anything, because HTTP rows are identified by `entityType`.
- Migration `20261122130000_audit_log_search_index`: partial index `AuditLog_nonhttp_createdAt_id_idx` on `("createdAt" DESC, "id" DESC) WHERE ("entityType" IS NULL OR "entityType" <> 'HTTP_REQUEST')`. Rollback: `rollback.sql`.
- `audit.interceptor.ts`: GET and HEAD requests are no longer audited. Mutations keep their `HTTP_REQUEST` rows. See `step-20-audit-writes.md`.
- No DB extension (no pg_trgm), no new packages, no UI change.

## Before / after (sequential median, ms; concurrent p95 at 10 workers, ms)

| Scenario | Before | After | Notes |
| --- | --- | --- | --- |
| global-search miss (API) | not valid | 164 / 167 ms (p95 226 / 216) | Before run self-matched, see below |
| global-search miss (SQL, true miss) | 15.6 s | n/a | Measured directly in SQL for the before state |
| global-search miss, concurrent p95 | not valid | 340 / 310 ms | |
| audit-facets | 269 → 99 ms (run 1); 117 → 111 ms (run 2) | | Concurrent p95 1552 → 641 ms; 916 → 658 ms |
| audit-page | 45 → 7.4 ms (run 1); 12 → 7.2 ms (run 2) | | |
| global-search-api, term "api" (hit path) | 30 → 151 ms (run 1); 22 → 305 ms (run 2) | | **Regression on hit path** |

Reading the table:

- **Before global-search miss numbers are invalid.** The search's own audit row contained the query text, so the miss query matched 12 false `AUDIT_EVENT` results and returned in about 43 ms. The real before-state cost is the true-miss SQL figure, 15.6 s. The Step 18 baseline figure of 4.8 s median was measured under the same self-match and should not be compared directly.
- **Hit-path regression is real and disclosed.** Before, self-matching audit rows satisfied `LIMIT` early for the term "api". Now those rows are excluded, so the search must scan further to fill the limit. Median rises from 30 to 151 ms (run 1) and 22 to 305 ms (run 2). It is still well under the 1 s target, but it is slower.
- **Residual tail.** A generic-plan issue (parameterised query chose the createdAt index, about 76 s) was removed by using the literal predicate in `$queryRaw`. After this change the p95 tail is gone in run 2.

## Not done (deliberate)

- No pg_trgm or any other extension.
- Batch loops (rack-power PDU sync, device import audit, topology access query, alert/SNMP bulk publish) were not changed. Step 18 did not measure them as a problem.
- Browser-level metrics from Step 18 were not re-measured.
- Concurrent numbers come from a shared laptop, so treat p95 as indicative.

## Verification

- `prisma generate`, build of database and snmp-core, `migrate deploy` from an empty PG16 database: pass.
- i18n, web typecheck, web lint, unit tests (snmp-core, api, snmp): pass (api unit 39 pass).
- HTTP integration: 39 pass, 0 fail, including the new test "Step 20 audit: reads are not audited and search skips HTTP_REQUEST rows".
- Full build: pass.
- Rollback then reapply tested on the perf copy: the index is removed by `rollback.sql` and recreated by `migration.sql`.
