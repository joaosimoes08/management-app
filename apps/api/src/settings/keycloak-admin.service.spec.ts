import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { KeycloakAdminService } from './keycloak-admin.service';

const actor = { id: 'actor', externalId: 'actor-external', username: 'admin', roles: ['ADMIN'] as const };
test('role updates preserve inherited roles, apply a direct diff and logout the user', async () => {
  const calls: { path: string; method: string; body?: string }[] = []; const records: any[] = [];
  const service = new KeycloakAdminService({ record: async (entry: any) => { records.push(entry); } } as never);
  const roles = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR', 'READ_ONLY'];
  let directRoles = [{ id: 'admin', name: 'ADMIN' }, { id: 'read', name: 'READ_ONLY' }];
  (service as any).request = async (path: string, init: RequestInit = {}) => {
    calls.push({ path, method: init.method ?? 'GET', body: init.body as string | undefined });
    if (path.endsWith('/role-mappings/realm')) {
      const changes = init.body ? JSON.parse(String(init.body)) as { id: string; name: string }[] : [];
      if (init.method === 'POST') directRoles = [...directRoles, ...changes.filter((role) => !directRoles.some((current) => current.name === role.name))];
      if (init.method === 'DELETE') directRoles = directRoles.filter((role) => !changes.some((removed) => removed.name === role.name));
      return directRoles;
    }
    if (path.endsWith('/role-mappings/realm/composite')) return [...directRoles, { id: 'audit', name: 'AUDITOR' }];
    if (path.endsWith('/role-mappings/realm/available')) return roles.filter((role) => !directRoles.some((current) => current.name === role)).map((role) => ({ id: role.toLowerCase(), name: role }));
    return undefined;
  };
  const result = await service.updateRoles('target', ['ADMIN', 'NETWORK_OPERATOR'], actor as never);
  assert.deepEqual(result.inheritedRoles, ['AUDITOR']); assert.ok(calls.some((call) => call.method === 'DELETE' && call.body?.includes('READ_ONLY'))); assert.ok(calls.some((call) => call.method === 'POST' && call.body?.includes('NETWORK_OPERATOR'))); assert.ok(calls.some((call) => call.path.endsWith('/logout'))); assert.ok(calls.every((call) => !call.path.startsWith('/roles/'))); assert.equal(records[0].action, 'USER_ROLES_UPDATED');
});

test('requested roles are resolved through user mappings without global role access', async () => {
  const calls: { path: string; method: string; body?: string }[] = [];
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  let directRoles = [{ id: 'read', name: 'READ_ONLY' }];
  (service as any).request = async (path: string, init: RequestInit = {}) => {
    calls.push({ path, method: init.method ?? 'GET', body: init.body as string | undefined });
    if (path.endsWith('/role-mappings/realm/composite')) return directRoles;
    if (path.endsWith('/role-mappings/realm/available')) return [{ id: 'network', name: 'NETWORK_OPERATOR' }];
    if (path.endsWith('/role-mappings/realm')) {
      if (init.method === 'POST') directRoles = [...directRoles, ...JSON.parse(String(init.body))];
      return directRoles;
    }
    return undefined;
  };

  const result = await service.grantRoles('target', ['NETWORK_OPERATOR']);

  assert.ok(result.effectiveRoles.includes('NETWORK_OPERATOR'));
  assert.ok(calls.some((call) => call.path.endsWith('/role-mappings/realm/available')));
  assert.ok(calls.some((call) => call.method === 'POST' && call.body?.includes('NETWORK_OPERATOR')));
  assert.ok(calls.every((call) => !call.path.startsWith('/roles/')));
});

test('role updates cannot leave a user without an effective application role', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never); (service as any).request = async () => [];
  await assert.rejects(() => service.updateRoles('target', [], actor as never), ConflictException);
});

test('role updates cannot remove the last active administrator', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  (service as any).request = async (path: string) => {
    if (path.includes('/role-mappings/realm')) return [{ id: 'admin', name: 'ADMIN' }];
    if (path.startsWith('/users?')) return [{ id: 'target', enabled: true }];
    return [];
  };
  await assert.rejects(() => service.updateRoles('target', ['READ_ONLY'], actor as never), (error: unknown) => {
    assert.equal(((error as ConflictException).getResponse() as { code: string }).code, 'LAST_ADMIN_REQUIRED');
    return true;
  });
});
