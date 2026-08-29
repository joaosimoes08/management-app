import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { AccessGroupService } from './access-group.service';

const actor = { id: 'actor-id', roles: ['ADMIN'] } as AuthenticatedUser;

describe('AccessGroupService.create', () => {
  it('creates Site associations atomically with the group', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      accessGroup: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => { createData = data; return { id: 'group-id', ...data }; },
      },
      site: { count: async () => 2 },
    } as unknown as PrismaClient;
    const audit = { record: async () => undefined } as unknown as AuditService;
    const service = new AccessGroupService(prisma, audit);

    await service.create({ name: ' Jacintos ', siteIds: ['site-a', 'site-b', 'site-a'] }, actor);

    assert.deepEqual(createData, {
      name: 'Jacintos',
      description: null,
      siteAssignments: { create: [{ siteId: 'site-a' }, { siteId: 'site-b' }] },
    });
  });

  it('rejects creation when any selected Site does not exist', async () => {
    const prisma = {
      accessGroup: { findFirst: async () => null, create: async () => { throw new Error('must not create'); } },
      site: { count: async () => 1 },
    } as unknown as PrismaClient;
    const service = new AccessGroupService(prisma, { record: async () => undefined } as unknown as AuditService);

    await assert.rejects(() => service.create({ name: 'Jacintos', siteIds: ['site-a', 'site-b'] }, actor), NotFoundException);
  });
});
