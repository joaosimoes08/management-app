import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CriticalAssetsService } from './critical-assets.service';

const site = { id: 'site-a', name: 'Site A', timezone: 'Europe/Lisbon' };
const device = { id: 'device-a', name: 'Router A', type: 'ROUTER' };

function schedulerService(options: { failFirstNotification?: boolean } = {}) {
  let attestationExists = false;
  let notificationWrites = 0;
  let notificationAttempts = 0;
  const prisma: any = {
    site: { findMany: async () => [site] },
    device: { findMany: async () => [device] },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const transactionState = { attestationExists, notificationWrites };
      const result = await callback({
        criticalAssetGroupMapping: { findUnique: async () => ({ group: { members: [{ userId: 'user-a' }] } }) },
        criticalAssetAttestation: { createMany: async () => {
          if (transactionState.attestationExists) return { count: 0 };
          transactionState.attestationExists = true;
          return { count: 1 };
        } },
        notification: { createMany: async () => {
          notificationAttempts += 1;
          if (options.failFirstNotification && notificationAttempts === 1) throw new Error('injected notification failure');
          transactionState.notificationWrites += 1;
          return { count: 1 };
        } },
      });
      attestationExists = transactionState.attestationExists;
      notificationWrites = transactionState.notificationWrites;
      return result;
    },
  };
  const service = new CriticalAssetsService(prisma, {} as any);
  return { service, getCounts: () => ({ attestationExists, notificationWrites, notificationAttempts }) };
}

test('notification failure rolls back the attestation and a later scheduler run retries delivery', async () => {
  const { service, getCounts } = schedulerService({ failFirstNotification: true });
  const mondayAfterNine = new Date('2026-11-09T10:00:00.000Z');
  await service.runWeeklyChecks(mondayAfterNine);
  assert.deepEqual(getCounts(), { attestationExists: false, notificationWrites: 0, notificationAttempts: 1 });
  await service.runWeeklyChecks(mondayAfterNine);
  assert.deepEqual(getCounts(), { attestationExists: true, notificationWrites: 1, notificationAttempts: 2 });
});

test('duplicate scheduler runs do not create duplicate attestations or notices', async () => {
  const { service, getCounts } = schedulerService();
  const mondayAfterNine = new Date('2026-11-09T10:00:00.000Z');
  await service.runWeeklyChecks(mondayAfterNine);
  await service.runWeeklyChecks(mondayAfterNine);
  assert.deepEqual(getCounts(), { attestationExists: true, notificationWrites: 1, notificationAttempts: 1 });
});

test('mapping rejects a group that is not assigned to the selected site', async () => {
  let upsertCalled = false;
  const prisma: any = {
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      accessGroupSite: { findUnique: async () => null },
      criticalAssetGroupMapping: { upsert: async () => { upsertCalled = true; } },
    }),
  };
  const access: any = { assertSite: async () => undefined };
  const service = new CriticalAssetsService(prisma, access);
  await assert.rejects(service.setMapping('site-a', 'ROUTER', 'foreign-group', 'Europe/Lisbon', { id: 'operator', roles: [] } as any), BadRequestException);
  assert.equal(upsertCalled, false);
});
