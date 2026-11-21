# Step 20 G3 decision: audit writes for reads

## Decision

GET and HEAD requests are no longer written to `AuditLog`. Mutating requests (POST, PUT, PATCH, DELETE) keep their `HTTP_REQUEST` rows. This is the default recommended in the Step 20 brief.

Implemented in `apps/api/src/audit/audit.interceptor.ts`: the interceptor returns `next.handle()` before writing when `request.method` is `GET` or `HEAD`.

## Why

- Step 18 showed that `INSERT AuditLog` counts were dominated by read traffic, and that the AuditLog table was growing mostly with `HTTP_REQUEST` rows.
- Reads carry no change to audit, so their audit value is low. Mutations remain fully audited.
- The change is a single guard in the interceptor. No migration is needed for it.

## Existing data

- Existing `HTTP_REQUEST` rows are not deleted. History is kept as is.
- Existing rows age out through the normal retention policy. No bulk delete was run as part of this step.
- The search now excludes `HTTP_REQUEST` rows (see `step-20-results.md`), so old rows do not affect search results.

## Trade-off

- Read access is no longer visible in the audit log. If a future requirement needs read-access auditing (for example, for sensitive data views), it should be added as explicit, named events for those views rather than through the generic HTTP interceptor.

## Rollback

Revert the guard in `audit.interceptor.ts`. Reads will be audited again from that point. Rows written in between remain.
