import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { IpamWorkflowsService, isUniqueViolation } from './ipam-workflows.service';

function service(createError: unknown) {
  const ipAddress = {
    findMany: async () => [],
    create: async () => { throw createError; },
    updateMany: async () => ({ count: 1 }),
  };
  const prisma = {
    subnet: { findUnique: async () => ({ id: 'subnet-1', cidr: '10.0.0.0/29', gateway: '10.0.0.1', version: 4 }) },
    ipAddress,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ ipAddress, ipReservation: { create: async () => ({ id: 'r', status: 'ACTIVE', expiresAt: new Date(), reason: 'x' }) } }),
  };
  const access = { assertSubnet: async () => undefined };
  const audit = { recordInTransaction: async () => undefined };
  return new IpamWorkflowsService(prisma as never, access as never, audit as never, {} as never);
}
const user = { id: 'u1' } as never;

test('isUniqueViolation only matches Prisma P2002', () => {
  assert.equal(isUniqueViolation({ code: 'P2002' }), true);
  assert.equal(isUniqueViolation({ code: 'P2003' }), false);
  assert.equal(isUniqueViolation(new Error('boom')), false);
  assert.equal(isUniqueViolation(null), false);
});

test('reserve-next maps a unique violation on create to 409 IP_RANGE_CHANGED', async () => {
  await assert.rejects(service({ code: 'P2002' }).reserveNext(user, 'subnet-1', { reason: 'teste' }), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { code: string }).code, 'IP_RANGE_CHANGED');
    return true;
  });
});

test('reserve-next rethrows any other create error instead of hiding it as IP_RANGE_CHANGED', async () => {
  const failure = Object.assign(new Error('connection lost'), { code: 'P1001' });
  await assert.rejects(service(failure).reserveNext(user, 'subnet-1', { reason: 'teste' }), (error: unknown) => error === failure);
});
