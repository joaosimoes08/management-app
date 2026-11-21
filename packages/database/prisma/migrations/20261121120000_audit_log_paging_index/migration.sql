-- Additive: supports cursor paging of the audit log in (createdAt desc, id desc) order.
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt" DESC, "id" DESC);
