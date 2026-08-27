import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RoleRequestService } from './role-request.service';

const user = { id: 'u1', externalId: 'kc-1', username: 'operator', roles: ['READ_ONLY'] as const };
const reviewer = { id: 'admin', externalId: 'kc-admin', username: 'admin', roles: ['ADMIN'] as const };
function service(prisma: any, keycloak: any = {}) {
  const value = Object.create(RoleRequestService.prototype) as RoleRequestService;
  Object.assign(value, { prisma, keycloak, audit: { record: async (entry: any) => entry } });
  return value;
}
test('submission normalizes roles and rejects invalid/effective roles and pending duplicates', async () => {
  const created: any[] = [];
  const base = { roleRequest: { findFirst: async () => null, create: async ({ data }: any) => { const row = { id: 'r1', ...data, status: 'PENDING', createdAt: new Date() }; created.push(row); return row; } } };
  const value = service(base, { effectiveRoles: async () => ['READ_ONLY'] });
  await value.submit(user as any, ['AUDITOR', 'AUDITOR', 'NETWORK_OPERATOR']);
  assert.deepEqual(created[0].roles, ['AUDITOR', 'NETWORK_OPERATOR']);
  await assert.rejects(() => value.submit(user as any, ['ADMIN'] as any), BadRequestException);
  const held = service(base, { effectiveRoles: async () => ['AUDITOR'] });
  await assert.rejects(() => held.submit(user as any, ['AUDITOR']), ConflictException);
  const duplicate = service({ roleRequest: { findFirst: async () => ({ id: 'existing' }) } }, { effectiveRoles: async () => [] });
  await assert.rejects(() => duplicate.submit(user as any, ['AUDITOR']), ConflictException);
});

test('approval grants additively, finalizes, notifies and audits', async () => {
  const row: any = { id: 'r1', userId: 'u1', roles: ['AUDITOR'], status: 'PENDING', createdAt: new Date(), user: { externalId: 'kc-1' } };
  const notifications: any[] = []; const audits: any[] = [];
  const prisma: any = { roleRequest: { updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }, findUnique: async () => row }, $transaction: async (fn: any) => fn({ roleRequest: { updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }, findUniqueOrThrow: async () => row }, notification: { create: async ({ data }: any) => notifications.push(data) } }) };
  const value = service(prisma, { grantRoles: async () => ({}) }); (value as any).audit = { record: async (entry: any) => audits.push(entry) };
  const result = await value.decide('r1', 'APPROVE', reviewer as any);
  assert.equal(result.status, 'APPROVED'); assert.equal(notifications.length, 1); assert.match(notifications[0].message, /logout/i); assert.equal(audits[0].action, 'ROLE_REQUEST_APPROVED');
});

test('rejection finalizes and notifies; non-pending requests are rejected', async () => {
  const row: any = { id: 'r1', userId: 'u1', roles: ['AUDITOR'], status: 'PENDING', createdAt: new Date(), user: { externalId: 'kc-1' } }; const notifications: any[] = [];
  const prisma: any = { roleRequest: { updateMany: async ({ data }: any) => { if (row.status !== 'PENDING') return { count: 0 }; Object.assign(row, data); return { count: 1 }; }, findUnique: async () => row }, $transaction: async (fn: any) => fn({ roleRequest: { updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }, findUniqueOrThrow: async () => row }, notification: { create: async ({ data }: any) => notifications.push(data) } }) };
  const value = service(prisma); const result = await value.decide('r1', 'REJECT', reviewer as any); assert.equal(result.status, 'REJECTED'); assert.equal(notifications.length, 1);
});

test('Keycloak failure keeps a claimed request processing for safe retry', async () => {
  const row: any = { id: 'r1', userId: 'u1', roles: ['AUDITOR'], status: 'PENDING', createdAt: new Date(), user: { externalId: 'kc-1' } };
  const prisma: any = { roleRequest: { updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }, findUnique: async () => row } };
  const value = service(prisma, { grantRoles: async () => { const e: any = new Error('down'); e.response = { code: 'KEYCLOAK_ADMIN_REQUEST_FAILED' }; throw e; } });
  await assert.rejects(() => value.decide('r1', 'APPROVE', reviewer as any)); assert.equal(row.status, 'PROCESSING');
});

test('a processing approval can be reconciled safely', async () => {
  const row: any = { id: 'r1', userId: 'u1', roles: ['AUDITOR'], status: 'PROCESSING', createdAt: new Date(), user: { externalId: 'kc-1' } };
  const notifications: any[] = [];
  const prisma: any = { roleRequest: { updateMany: async () => ({ count: 0 }), findUnique: async () => row }, $transaction: async (fn: any) => fn({ roleRequest: { updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }, findUniqueOrThrow: async () => row }, notification: { create: async ({ data }: any) => notifications.push(data) } }) };
  const value = service(prisma, { grantRoles: async () => ({}) });
  const result = await value.decide('r1', 'APPROVE', reviewer as any);
  assert.equal(result.status, 'APPROVED'); assert.equal(notifications.length, 1);
});

test('database finalization failure leaves a granted request processing', async () => {
  const row: any = { id: 'r1', userId: 'u1', roles: ['AUDITOR'], status: 'PENDING', createdAt: new Date(), user: { externalId: 'kc-1' } };
  const prisma: any = {
    roleRequest: {
      updateMany: async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; },
      findUnique: async () => row,
    },
    $transaction: async () => { throw new Error('database unavailable'); },
  };
  const value = service(prisma, { grantRoles: async () => ({}) });
  await assert.rejects(() => value.decide('r1', 'APPROVE', reviewer as any));
  assert.equal(row.status, 'PROCESSING');
});
