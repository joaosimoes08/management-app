import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { IpReservationService } from './ip-reservation.service';

test('reservation duration is capped at thirty days', async () => {
  const service = new IpReservationService({} as never, {} as never, {} as never);
  await assert.rejects(() => service.create({ ipAddressId: 'ip', durationHours: 721, reason: 'maintenance' }, { id: 'user' } as never), BadRequestException);
});

test('expiry marks a due reservation once and never frees an IP that fails the safety predicate', async () => {
  let active = true;
  let releaseWhere: unknown;
  const item = { id: 'reservation', ipAddressId: 'ip' };
  const tx = {
    ipReservation: { updateMany: async () => { if (!active) return { count: 0 }; active = false; return { count: 1 }; } },
    ipAddress: { updateMany: async ({ where }: { where: unknown }) => { releaseWhere = where; return { count: 0 }; } },
  };
  const prisma = {
    ipReservation: { findMany: async () => active ? [item] : [] },
    $transaction: async (run: (transaction: any) => Promise<unknown>) => run(tx),
  };
  const audit = { recordInTransaction: async () => ({}) };
  const service = new IpReservationService(prisma as never, audit as never, {} as never);
  assert.equal(await service.expireDue(new Date()), 1);
  assert.deepEqual(await service.expireDue(new Date()), 0);
  assert.deepEqual(releaseWhere, { id: 'ip', state: 'RESERVED', deviceId: null, interfaceId: null, hostId: null, natRules: { none: {} }, translatedNatRules: { none: {} } });
});
