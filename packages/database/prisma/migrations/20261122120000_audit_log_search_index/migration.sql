-- Additive: partial index for audit search and recent-window reads that skip HTTP_REQUEST rows.
-- Prisma cannot express a partial index in schema.prisma, so this migration is its source of truth.
-- Note: a plain CREATE INDEX blocks writes to "AuditLog" while it builds (seconds on the reference copy).
CREATE INDEX "AuditLog_nonhttp_createdAt_id_idx" ON "AuditLog" ("createdAt" DESC, "id" DESC) WHERE ("entityType" IS NULL OR "entityType" <> 'HTTP_REQUEST');
