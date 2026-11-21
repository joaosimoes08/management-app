import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { auditCsv, decodeAuditCursor, deriveAuditDiff, encodeAuditCursor } from './audit-query';
import { AuditService } from './audit.service';

const ID = '11111111-1111-4111-8111-111111111111';

test('audit cursor round-trips and rejects tampered values', () => {
  const createdAt = new Date('2026-11-21T10:00:00.123Z');
  const cursor = encodeAuditCursor({ createdAt, id: ID });
  assert.deepEqual(decodeAuditCursor(cursor), { createdAt, id: ID });
  assert.equal(decodeAuditCursor(undefined), undefined);
  for (const bad of ['nope', Buffer.from('2026-11-21T10:00:00.123Z|not-a-uuid').toString('base64url'), Buffer.from(`yesterday|${ID}`).toString('base64url'), Buffer.from(`2026-11-21T10:00:00.123Z|${ID}|x`).toString('base64url')]) {
    assert.throws(() => decodeAuditCursor(bad), BadRequestException);
  }
});

test('deriveAuditDiff exposes only before/after shapes that are actually stored', () => {
  assert.deepEqual(deriveAuditDiff({ previousDays: 90, nextDays: 30 }), [{ field: 'days', before: 90, after: 30 }]);
  assert.deepEqual(deriveAuditDiff({ previousDirectRoles: ['A'], nextDirectRoles: ['A', 'B'], inheritedRoles: [] }), [{ field: 'directRoles', before: ['A'], after: ['A', 'B'] }]);
  assert.deepEqual(deriveAuditDiff({ beforeValues: { name: 'a', mode: 'TRUNK' }, observedValues: { name: 'b', mode: 'TRUNK' } }), [{ field: 'name', before: 'a', after: 'b' }]);
  assert.deepEqual(deriveAuditDiff({ before: { x: 1 }, after: { x: 1, y: 2 } }), [{ field: 'y', before: null, after: 2 }]);
  assert.equal(deriveAuditDiff({ siteId: 's', revision: 2 }), null);
  assert.equal(deriveAuditDiff({ previousDays: 90 }), null);
  assert.equal(deriveAuditDiff(null), null);
  assert.equal(deriveAuditDiff(['x']), null);
});

test('auditCsv quotes, escapes and neutralises spreadsheet formulas', () => {
  const csv = auditCsv([{ id: ID, createdAt: new Date('2026-11-21T10:00:00Z'), action: '=HYPERLINK("x")', entityType: 'Device', entityId: null, ipAddress: null, metadata: { note: 'a,b' }, user: { username: 'joao', displayName: 'Joao "J"' } }]);
  const [header, row] = csv.trim().split('\r\n');
  assert.equal(header, 'id,createdAt,actor,actorName,action,entityType,entityId,ipAddress,metadata');
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(row.includes('"Joao ""J"""'));
  assert.ok(row.includes('"{""note"":""a,b""}"'));
});

test('page() asks for limit+1 rows in a stable order, returns a cursor and a diff', async () => {
  const rows = [0, 1, 2].map((i) => ({ id: `1111111${i}-1111-4111-8111-111111111111`, createdAt: new Date(Date.UTC(2026, 10, 21, 10, 0, 0) - i * 1000), action: 'AUDIT_RETENTION_UPDATED', entityType: 'SystemSettings', entityId: 's', metadata: { previousDays: 90, nextDays: 30 }, ipAddress: null, userId: null, user: null }));
  let seen: any;
  const prisma = { auditLog: { findMany: async (args: any) => { seen = args; return rows; } } } as any;
  const service = Object.create(AuditService.prototype) as AuditService; (service as any).prisma = prisma;
  const page = await service.page({ limit: 2, action: 'AUDIT_RETENTION_UPDATED', excludeHttp: true });
  assert.equal(seen.take, 3);
  assert.deepEqual(seen.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.equal(page.items.length, 2); assert.equal(page.hasMore, true);
  assert.deepEqual(decodeAuditCursor(page.nextCursor!), { createdAt: rows[1].createdAt, id: rows[1].id });
  assert.deepEqual(page.items[0].diff, [{ field: 'days', before: 90, after: 30 }]); assert.equal(page.items[0].hasDiff, true);
  await service.page({ cursor: page.nextCursor! });
  assert.deepEqual(seen.where.AND[1], { OR: [{ createdAt: { lt: rows[1].createdAt } }, { createdAt: rows[1].createdAt, id: { lt: rows[1].id } }] });
  await assert.rejects(service.page({ from: 'not-a-date' }), BadRequestException);
  await assert.rejects(service.page({ from: '2026-11-22', to: '2026-11-21' }), BadRequestException);
  await assert.rejects(service.page({ actorId: 'bob' }), BadRequestException);
});
