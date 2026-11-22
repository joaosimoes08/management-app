import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { LifecycleDatesService } from './lifecycle-dates.service';

const actor = { id: 'user-1', username: 'operator', externalId: 'external-1', roles: ['ADMIN'] } as AuthenticatedUser;
const device = { id: 'device-1', type: 'SERVER', siteId: 'site-1', rack: null };

function buildService(fallbackGroup: { id: string } | null) {
  let createArgs: any;
  const prisma = {
    device: { findUnique: async () => device },
    accessGroup: { findFirst: async () => fallbackGroup },
    lifecycleDate: { create: async (args: any) => {
      createArgs = args;
      return { id: 'date-1', ...args.data, dueDate: args.data.dueDate, reminderDays: args.data.reminderDays, device: { id: device.id, name: 'Server', type: device.type, siteId: device.siteId, site: { id: 'site-1', name: 'Site' }, rack: null }, responsibleUser: null, responsibleGroup: { id: args.data.responsibleGroupId, name: 'Site coordinator' } };
    } },
  };
  const access = { assertDevice: async () => undefined };
  const audit = { record: async () => undefined };
  const service = new LifecycleDatesService(prisma as unknown as PrismaClient, access as never, audit as never);
  return { service, created: () => createArgs };
}

test('lifecycle date creation applies reminder defaults and assigned Site coordinator fallback', async () => {
  const { service, created } = buildService({ id: 'coordinator-group' });
  await service.create(device.id, { kind: 'LICENSE', dueDate: '2026-12-31' }, actor);
  assert.equal(created().data.dueDate.toISOString(), '2026-12-31T00:00:00.000Z');
  assert.deepEqual(created().data.reminderDays, [30, 7, 0]);
  assert.equal(created().data.responsibleGroupId, 'coordinator-group');
  assert.equal(created().data.responsibleUserId, null);
});

test('lifecycle date creation requires an explicit assignee when no Site coordinator group is configured', async () => {
  const { service } = buildService(null);
  await assert.rejects(() => service.create(device.id, { kind: 'WARRANTY', dueDate: '2026-12-31' }, actor), BadRequestException);
});

test('lifecycle date creation rejects duplicate reminder days before persistence', async () => {
  const { service, created } = buildService({ id: 'coordinator-group' });
  await assert.rejects(() => service.create(device.id, { kind: 'SUPPORT', dueDate: '2026-12-31', reminderDays: [7, 7] }, actor), BadRequestException);
  assert.equal(created(), undefined);
});

function buildListService() {
  const calls: any[] = [];
  const prisma = {
    lifecycleDate: { findMany: async (args: any) => {
      calls.push(args);
      return [{ id: 'date-1', deviceId: device.id, kind: 'WARRANTY', dueDate: new Date('2031-05-01T00:00:00.000Z'), reminderDays: [30], device: { id: device.id, name: 'Server', type: device.type, siteId: device.siteId, site: { id: 'site-1', name: 'Site' }, rack: null }, responsibleUser: null, responsibleGroup: null }];
    } },
  };
  const access = { assertDevice: async () => undefined };
  const service = new LifecycleDatesService(prisma as unknown as PrismaClient, access as never, { record: async () => undefined } as never);
  return { service, calls };
}

test('lifecycle list keeps the 370-day cap for the site calendar', async () => {
  const { service, calls } = buildListService();
  await assert.rejects(() => service.list(actor, 'site-1', '2000-01-01', '2100-01-01'), BadRequestException);
  await assert.rejects(() => service.list(actor, 'site-1', undefined, undefined), BadRequestException);
  assert.equal(calls.length, 0);
});

test('lifecycle list by deviceId (Device 360) needs no date range and filters in the database', async () => {
  const { service, calls } = buildListService();
  const result = await service.list(actor, 'site-1', undefined, undefined, device.id);
  assert.equal(calls[0].where.deviceId, device.id);
  assert.equal(calls[0].where.dueDate, undefined);
  assert.equal(result.items[0].dueDate, '2031-05-01');
});

test('lifecycle list by deviceId still validates an explicit range when one is given', async () => {
  const { service, calls } = buildListService();
  await service.list(actor, 'site-1', '2000-01-01', '2100-01-01', device.id);
  assert.equal(calls[0].where.dueDate.gte.toISOString(), '2000-01-01T00:00:00.000Z');
  await assert.rejects(() => service.list(actor, 'site-1', '2030-01-02', '2030-01-01', device.id), BadRequestException);
  await assert.rejects(() => service.list(actor, '', undefined, undefined, device.id), BadRequestException);
});
