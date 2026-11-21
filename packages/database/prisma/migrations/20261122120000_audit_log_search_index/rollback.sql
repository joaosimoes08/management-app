-- Manual rollback for 20261122120000_audit_log_search_index. Safe at any time: only drops the partial index.
DROP INDEX IF EXISTS "AuditLog_nonhttp_createdAt_id_idx";
