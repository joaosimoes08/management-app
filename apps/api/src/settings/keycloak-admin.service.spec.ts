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

test('directory federation status never returns the stored bind secret', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  (service as any).request = async (path: string) => path.includes('type=')
    ? [{ id: 'provider', name: 'management-app-directory-ldap', config: { connectionUrl: ['ldaps://ldap.example.org:636'], bindDn: ['uid=svc,dc=example,dc=org'], bindCredential: ['directory-secret'], usersDn: ['ou=people,dc=example,dc=org'], vendor: ['other'] } }]
    : [{ id: 'mapper', name: 'management-app-directory-groups', parentId: 'provider', config: { 'groups.dn': ['ou=groups,dc=example,dc=org'], 'group.name.ldap.attribute': ['cn'], 'group.object.classes': ['groupOfNames'], 'membership.ldap.attribute': ['member'], 'app.groupRoleMappings': ['[{"groupName":"network-admins","appRole":"ADMIN"}]'] } }];
  const result = await service.directoryFederationStatus();
  assert.deepEqual(result.groupRoleMappings, [{ groupName: 'network-admins', appRole: 'ADMIN' }]);
  assert.equal(JSON.stringify(result).includes('directory-secret'), false);
});

test('directory federation rejects plaintext LDAP before making Keycloak requests', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  let calls = 0;
  (service as any).request = async () => { calls += 1; return []; };
  await assert.rejects(() => service.updateDirectoryFederation({ vendor: 'other', connectionUrl: 'ldap://ldap.example.org:389', bindDn: 'uid=svc', bindCredential: 'secret', usersDn: 'ou=people', usernameLdapAttribute: 'uid', groupsDn: 'ou=groups', groupNameLdapAttribute: 'cn', groupObjectClass: 'groupOfNames', membershipLdapAttribute: 'member', groupRoleMappings: [] } as never, actor as never), (error: unknown) => {
    assert.equal(((error as any).getResponse() as { code: string }).code, 'DIRECTORY_LDAPS_REQUIRED');
    return true;
  });
  assert.equal(calls, 0);
});

test('directory federation rejects duplicate group-role mappings before making Keycloak requests', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  let calls = 0;
  (service as any).request = async () => { calls += 1; return []; };
  await assert.rejects(() => service.updateDirectoryFederation({ vendor: 'other', connectionUrl: 'ldaps://ldap.example.org:636', bindDn: 'uid=svc', bindCredential: 'secret', usersDn: 'ou=people', usernameLdapAttribute: 'uid', groupsDn: 'ou=groups', groupNameLdapAttribute: 'cn', groupObjectClass: 'groupOfNames', membershipLdapAttribute: 'member', groupRoleMappings: [{ groupName: 'operators', appRole: 'READ_ONLY' }, { groupName: 'operators', appRole: 'READ_ONLY' }] } as never, actor as never), (error: unknown) => {
    assert.equal(((error as any).getResponse() as { code: string }).code, 'DIRECTORY_GROUP_MAPPING_DUPLICATE');
    return true;
  });
  assert.equal(calls, 0);
});

test('directory connection failures never echo bind credentials', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  (service as any).accessToken = async () => 'test-token';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'bind-password-must-not-escape' }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    await assert.rejects(() => service.testDirectoryConnection({ vendor: 'other', connectionUrl: 'ldaps://ldap.example.org:636', bindDn: 'uid=svc', bindCredential: 'bind-password-must-not-escape', usersDn: 'ou=people', usernameLdapAttribute: 'uid', groupsDn: 'ou=groups', groupNameLdapAttribute: 'cn', groupObjectClass: 'groupOfNames', membershipLdapAttribute: 'member', groupRoleMappings: [] } as never), (error: unknown) => {
      const response = (error as any).getResponse();
      assert.equal(JSON.stringify(response).includes('bind-password-must-not-escape'), false);
      return true;
    });
  } finally { globalThis.fetch = previousFetch; }
});

test('directory reconciliation revokes roles removed from the saved group mapping', async () => {
  const service = new KeycloakAdminService({ record: async () => undefined } as never);
  (service as any).accessToken = async () => 'test-token';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
  let directRoles = [{ id: 'admin-role', name: 'ADMIN' }];
  const calls: { path: string; method: string }[] = [];
  (service as any).request = async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'; calls.push({ path, method });
    if (path.startsWith('/groups?')) return [{ id: 'group-id', name: 'operators' }];
    if (path === '/roles/ADMIN') return { id: 'admin-role', name: 'ADMIN' };
    if (path.endsWith('/role-mappings/realm/available')) return [];
    if (path.endsWith('/role-mappings/realm')) {
      if (method === 'DELETE') { const removed = JSON.parse(String(init.body)) as { name: string }[]; directRoles = directRoles.filter((role) => !removed.some((item) => item.name === role.name)); }
      return directRoles;
    }
    return undefined;
  };
  try {
    // The component already contains the newly saved empty mapping list. Reconciliation
    // must use the pre-update mapping snapshot passed separately.
    await (service as any).reconcileDirectoryGroupRoles(
      { id: 'mapper-id', parentId: 'provider-id', name: 'mapper', providerId: 'group-ldap-mapper', providerType: 'org.keycloak.storage.ldap.mappers.LDAPStorageMapper', config: { 'app.groupRoleMappings': ['[]'] } },
      [],
      [{ groupName: 'operators', appRole: 'ADMIN' }],
    );
  } finally { globalThis.fetch = previousFetch; }
  assert.deepEqual(directRoles, []);
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/role-mappings/realm')));
});
