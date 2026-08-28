import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AuthService } from './auth.service';

type StoredUser = {
  id: string;
  externalId: string;
  username: string;
  displayName?: string;
  email?: string;
};

function concurrentPrisma() {
  let storedUser: StoredUser | undefined;
  let upsertCalls = 0;
  const user = {
    findUnique: async ({ where }: { where: { externalId?: string; username?: string } }) => {
      if (where.externalId) return storedUser?.externalId === where.externalId ? storedUser : null;
      if (where.username) return storedUser?.username === where.username ? storedUser : null;
      return null;
    },
    update: async ({ data }: { data: Partial<StoredUser> }) => {
      if (!storedUser) throw new Error('User not found');
      storedUser = { ...storedUser, ...data };
      return storedUser;
    },
    upsert: async ({ create, update }: { create: Omit<StoredUser, 'id'>; update: Partial<StoredUser> }) => {
      upsertCalls += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      storedUser = storedUser
        ? { ...storedUser, ...update }
        : { id: 'user-1', ...create };
      return storedUser;
    },
  };
  const prisma = {
    user,
    $transaction: async (operation: (tx: unknown) => Promise<void>) => operation({
      userRole: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 1 }),
      },
    }),
  };
  return { prisma, getStoredUser: () => storedUser, getUpsertCalls: () => upsertCalls };
}

test('concurrent first requests provision one user without a create race', async () => {
  const database = concurrentPrisma();
  const audit = { record: async () => undefined };
  const service = new AuthService(database.prisma as never, audit as never);
  const input = {
    externalId: 'keycloak-user-1',
    username: 'reader',
    displayName: 'Read Only',
    email: 'reader@example.test',
    roles: ['READ_ONLY'],
  };

  const [first, second] = await Promise.all([service.syncUser(input), service.syncUser(input)]);

  assert.equal(first.id, second.id);
  assert.equal(database.getStoredUser()?.externalId, input.externalId);
  assert.equal(database.getUpsertCalls(), 2);
});
