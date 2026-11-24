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

/** Behaves like Postgres under a real race: both requests miss on read, both INSERT, the second hits the unique index. */
function uniqueIndexPrisma() {
  const rows: StoredUser[] = [];
  let inserts = 0;
  const unique = () => Object.assign(new Error('Unique constraint failed on the fields: (`username`)'), { code: 'P2002' });
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { externalId?: string; username?: string } }) =>
        rows.find((row) => (where.externalId ? row.externalId === where.externalId : row.username === where.username)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredUser> }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error('User not found');
        Object.assign(row, data);
        return { ...row };
      },
      upsert: async ({ create }: { create: Omit<StoredUser, 'id'> }) => {
        inserts += 1;
        await new Promise<void>((resolve) => setImmediate(resolve)); // let the other request read "no user" first
        if (rows.some((row) => row.username === create.username || row.externalId === create.externalId)) throw unique();
        const row = { id: `user-${rows.length + 1}`, ...create };
        rows.push(row);
        return { ...row };
      },
    },
    $transaction: async (operation: (tx: unknown) => Promise<void>) => operation({ userRole: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) } }),
  };
  return { prisma, rows, inserts: () => inserts };
}

test('syncUser is idempotent when two first-load requests race and one hits P2002', async () => {
  const database = uniqueIndexPrisma();
  const audited: string[] = [];
  const service = new AuthService(database.prisma as never, { record: async ({ userId }: { userId: string }) => { audited.push(userId); } } as never);
  const input = { externalId: 'kc-race', username: 'racer', displayName: 'Racer', roles: ['READ_ONLY'] };

  const [first, second] = await Promise.all([service.syncUser(input), service.syncUser(input)]);

  assert.equal(database.inserts(), 2, 'both requests really attempted the insert');
  assert.equal(database.rows.length, 1);
  assert.equal(first.id, second.id);
  assert.deepEqual(second, { id: 'user-1', externalId: 'kc-race', username: 'racer', roles: ['READ_ONLY'] });
  assert.deepEqual(audited, ['user-1', 'user-1']);
});

test('syncUser still surfaces errors that are not unique violations, and does not retry them', async () => {
  let calls = 0;
  const prisma = { user: { findUnique: async () => { calls += 1; throw Object.assign(new Error('db down'), { code: 'P1001' }); } } };
  const service = new AuthService(prisma as never, { record: async () => undefined } as never);
  await assert.rejects(() => service.syncUser({ externalId: 'x', username: 'x', roles: [] }), /db down/);
  assert.equal(calls, 1);
});

/** A returning user: stored row with its roles, counting every write syncUser makes. */
function returningUserPrisma(stored: StoredUser & { roles: Array<{ role: string }> }) {
  const writes = { update: 0, transaction: 0 };
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { externalId?: string } }) => (where.externalId === stored.externalId ? { ...stored, roles: [...stored.roles] } : null),
      update: async ({ data }: { data: Partial<StoredUser> }) => { writes.update += 1; Object.assign(stored, data); return { ...stored }; },
      upsert: async () => { throw new Error('returning users are never upserted'); },
    },
    $transaction: async (operation: (tx: unknown) => Promise<void>) => { writes.transaction += 1; return operation({ userRole: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) } }); },
  };
  return { prisma, writes };
}

test('a returning user with unchanged profile and roles causes no User or UserRole writes, but is still audited', async () => {
  const database = returningUserPrisma({ id: 'user-1', externalId: 'kc-1', username: 'ana', displayName: 'Ana', email: 'ana@example.test', roles: [{ role: 'ADMIN' }, { role: 'READ_ONLY' }] });
  const audited: string[] = [];
  const service = new AuthService(database.prisma as never, { record: async ({ action }: { action: string }) => { audited.push(action); } } as never);

  const result = await service.syncUser({ externalId: 'kc-1', username: 'ana', displayName: 'Ana', email: 'ana@example.test', roles: ['READ_ONLY', 'ADMIN', 'ADMIN', 'offline_access'] });

  assert.deepEqual(database.writes, { update: 0, transaction: 0 });
  assert.deepEqual(result, { id: 'user-1', externalId: 'kc-1', username: 'ana', roles: ['READ_ONLY', 'ADMIN'] });
  assert.deepEqual(audited, ['AUTHENTICATED']);
});

test('a returning user is updated when a profile field changes, and roles are rewritten when the role set changes', async () => {
  const emailChanged = returningUserPrisma({ id: 'user-1', externalId: 'kc-1', username: 'ana', displayName: 'Ana', email: 'old@example.test', roles: [{ role: 'ADMIN' }] });
  await new AuthService(emailChanged.prisma as never, { record: async () => undefined } as never).syncUser({ externalId: 'kc-1', username: 'ana', displayName: 'Ana', email: 'new@example.test', roles: ['ADMIN'] });
  assert.deepEqual(emailChanged.writes, { update: 1, transaction: 0 });

  const roleRemoved = returningUserPrisma({ id: 'user-1', externalId: 'kc-1', username: 'ana', roles: [{ role: 'ADMIN' }, { role: 'READ_ONLY' }] });
  await new AuthService(roleRemoved.prisma as never, { record: async () => undefined } as never).syncUser({ externalId: 'kc-1', username: 'ana', roles: ['ADMIN'] });
  assert.deepEqual(roleRemoved.writes, { update: 0, transaction: 1 });

  const roleAdded = returningUserPrisma({ id: 'user-1', externalId: 'kc-1', username: 'ana', roles: [{ role: 'READ_ONLY' }] });
  await new AuthService(roleAdded.prisma as never, { record: async () => undefined } as never).syncUser({ externalId: 'kc-1', username: 'ana', roles: ['READ_ONLY', 'ADMIN'] });
  assert.deepEqual(roleAdded.writes, { update: 0, transaction: 1 });

  const allRolesRevoked = returningUserPrisma({ id: 'user-1', externalId: 'kc-1', username: 'ana', roles: [{ role: 'READ_ONLY' }] });
  await new AuthService(allRolesRevoked.prisma as never, { record: async () => undefined } as never).syncUser({ externalId: 'kc-1', username: 'ana', roles: [] });
  assert.deepEqual(allRolesRevoked.writes, { update: 0, transaction: 1 });
});
