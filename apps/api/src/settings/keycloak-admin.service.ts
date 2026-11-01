import { BadGatewayException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApplicationRole, isApplicationRole } from '../auth/roles';
import { AuthenticatedUser } from '../auth/auth.service';
import { UpdateDirectoryFederationDto } from './dto';

type KeycloakUser = { id: string; username?: string; firstName?: string; lastName?: string; email?: string; enabled?: boolean; serviceAccountClientId?: string };
type KeycloakRole = { id: string; name: string; description?: string; composite?: boolean; clientRole?: boolean };
type KeycloakComponent = { id?: string; name: string; providerId: string; providerType: string; parentId?: string; config?: Record<string, string[]> };

@Injectable()
export class KeycloakAdminService {
  constructor(private readonly audit: AuditService) {}
  private tokenCache?: { value: string; expiresAt: number };
  private get baseUrl() { return (process.env.KEYCLOAK_ADMIN_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8080')).replace(/\/$/, ''); }
  private get realm() { return process.env.KEYCLOAK_ADMIN_REALM ?? 'COCiber'; }
  private get clientId() { return process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? (process.env.NODE_ENV === 'production' ? '' : 'simoes-settings-admin'); }
  private get clientSecret() { return process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'change-me-settings-admin-secret'); }
  private assertConfigured() { if (!this.baseUrl || !this.clientId || !this.clientSecret) throw new ServiceUnavailableException({ code: 'KEYCLOAK_ADMIN_NOT_CONFIGURED', message: 'A integração administrativa do Keycloak não está configurada.' }); }
  private async accessToken() {
    this.assertConfigured();
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 15_000) return this.tokenCache.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
    const response = await fetch(`${this.baseUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) throw new ServiceUnavailableException({ code: 'KEYCLOAK_ADMIN_AUTH_FAILED', message: 'Não foi possível autenticar o serviço administrativo no Keycloak.' });
    const payload = await response.json() as { access_token: string; expires_in?: number };
    this.tokenCache = { value: String(payload.access_token), expiresAt: Date.now() + (payload.expires_in ?? 60) * 1000 };
    return this.tokenCache.value;
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(`${this.baseUrl}/admin/realms/${encodeURIComponent(this.realm)}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
    if (!response.ok) {
      await response.text().catch(() => '');
      if (response.status === 403) throw new BadGatewayException({ code: 'KEYCLOAK_ADMIN_PERMISSION_REQUIRED', message: 'O service account do Keycloak não tem as permissões necessárias para configurar a federação. Confirma a role realm-management/manage-realm.' });
      if (response.status === 401) throw new ServiceUnavailableException({ code: 'KEYCLOAK_ADMIN_AUTH_FAILED', message: 'O Keycloak recusou a autenticação administrativa.' });
      throw new BadGatewayException({ code: 'KEYCLOAK_ADMIN_REQUEST_FAILED', message: 'O Keycloak recusou a operação administrativa.' });
    }
    if (response.status === 204) return undefined as T;
    const payload = await response.text();
    return (payload ? JSON.parse(payload) : undefined) as T;
  }

  private readonly directoryProviderName = 'management-app-directory-ldap';
  private readonly directoryMapperName = 'management-app-directory-groups';
  private componentConfig(value: Record<string, string | boolean | number>) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, [String(item)]])); }
  private configValue(component: KeycloakComponent, key: string) { return component.config?.[key]?.[0] ?? ''; }
  private async directoryComponents(parentId?: string) { return this.request<KeycloakComponent[]>(parentId ? `/components?parent=${encodeURIComponent(parentId)}` : '/components?type=org.keycloak.storage.UserStorageProvider'); }
  private directoryStatus(provider?: KeycloakComponent, mapper?: KeycloakComponent) {
    const serialized = this.configValue(mapper ?? ({} as KeycloakComponent), 'app.groupRoleMappings');
    let mappings: { groupName: string; appRole: string }[] = [];
    try { const value = JSON.parse(serialized); if (Array.isArray(value)) mappings = value; } catch { /* Ignore invalid legacy metadata and report no mappings. */ }
    return {
      configured: Boolean(provider),
      vendor: provider && this.configValue(provider, 'vendor') === 'ad' ? 'ad' : 'other',
      connectionUrl: provider ? this.configValue(provider, 'connectionUrl') : '',
      bindDn: provider ? this.configValue(provider, 'bindDn') : '',
      usersDn: provider ? this.configValue(provider, 'usersDn') : '',
      usernameLdapAttribute: provider ? this.configValue(provider, 'usernameLDAPAttribute') : 'uid',
      groupsDn: mapper ? this.configValue(mapper, 'groups.dn') : '',
      groupNameLdapAttribute: mapper ? this.configValue(mapper, 'group.name.ldap.attribute') : 'cn',
      groupObjectClass: mapper ? this.configValue(mapper, 'group.object.classes') : 'groupOfNames',
      membershipLdapAttribute: mapper ? this.configValue(mapper, 'membership.ldap.attribute') : 'member',
      groupRoleMappings: mappings,
      status: provider ? 'CONFIGURED' : 'NOT_CONFIGURED',
    };
  }
  async directoryFederationStatus() {
    const components = await this.directoryComponents();
    const provider = components.find((item) => item.name === this.directoryProviderName);
    const mapper = provider ? (await this.directoryComponents(provider.id)).find((item) => item.name === this.directoryMapperName) : undefined;
    return this.directoryStatus(provider, mapper);
  }
  async testDirectoryConnection(input: UpdateDirectoryFederationDto) {
    this.assertSecureDirectoryConfig(input);
    if (!input.bindCredential) throw new BadGatewayException({ code: 'DIRECTORY_BIND_CREDENTIAL_REQUIRED', message: 'Indica a credencial de serviço para testar a ligação.' });
    const token = await this.accessToken();
    const body = new URLSearchParams({ action: 'testConnection', connectionUrl: input.connectionUrl, bindDn: input.bindDn, bindCredential: input.bindCredential, useTruststoreSpi: 'ldapsOnly', connectionTimeout: '10000' });
    let response: Response;
    try { response = await fetch(`${this.baseUrl}/admin/realms/${encodeURIComponent(this.realm)}/testLDAPConnection`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12_000) }); }
    catch { throw new BadGatewayException({ code: 'DIRECTORY_CONNECTION_FAILED', message: 'O Keycloak não conseguiu ligar ao diretório. Confirma o endereço LDAPS, a confiança do certificado e a disponibilidade do servidor.' }); }
    if (!response.ok) throw new BadGatewayException({ code: 'DIRECTORY_CONNECTION_FAILED', message: 'O Keycloak recusou o teste LDAPS. Confirma o bind DN, a credencial e a confiança do certificado.' });
    const result = await response.json().catch(() => ({})) as { error?: string; result?: string };
    if (result.error || result.result?.toLowerCase().includes('error')) throw new BadGatewayException({ code: 'DIRECTORY_CONNECTION_FAILED', message: 'O teste LDAPS falhou. Confirma o bind DN, a credencial e a confiança do certificado.' });
    return { status: 'CONNECTED', message: 'O Keycloak conseguiu autenticar no diretório por LDAPS.' };
  }
  private assertSecureDirectoryConfig(input: UpdateDirectoryFederationDto) {
    let url: URL;
    try { url = new URL(input.connectionUrl); } catch { throw new BadGatewayException({ code: 'DIRECTORY_LDAPS_REQUIRED', message: 'Usa um endereço LDAPS válido, por exemplo ldaps://ldap.example.org:636.' }); }
    if (url.protocol !== 'ldaps:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '636') || (url.pathname !== '/' && url.pathname !== '')) throw new BadGatewayException({ code: 'DIRECTORY_LDAPS_REQUIRED', message: 'A federação só aceita LDAPS na porta 636, sem credenciais no endereço.' });
    const mappingKeys = input.groupRoleMappings?.map((mapping) => `${mapping.groupName.trim()}\u0000${mapping.appRole}`) ?? [];
    if (!input.groupRoleMappings || input.groupRoleMappings.some((mapping) => !mapping.groupName.trim()) || new Set(mappingKeys).size !== mappingKeys.length) throw new BadGatewayException({ code: 'DIRECTORY_GROUP_MAPPING_DUPLICATE', message: 'Cada combinação de grupo e role tem de ser única.' });
  }
  private roleConfigRepresentations(roles: KeycloakRole[], names: string[]) { return names.map((name) => roles.find((role) => role.name === name)).filter((role): role is KeycloakRole => Boolean(role)); }
  private async reconcileDirectoryGroupRoles(mapper: KeycloakComponent, mappings: { groupName: string; appRole: string }[], previous: { groupName: string; appRole: string }[]) {
    const sync = await fetch(`${this.baseUrl}/admin/realms/${encodeURIComponent(this.realm)}/user-storage/${encodeURIComponent(mapper.parentId ?? '')}/mappers/${encodeURIComponent(mapper.id ?? '')}/sync?direction=fedToKeycloak`, { method: 'POST', headers: { authorization: `Bearer ${await this.accessToken()}` } });
    if (!sync.ok) throw new BadGatewayException({ code: 'DIRECTORY_GROUP_SYNC_FAILED', message: 'Keycloak não conseguiu sincronizar os grupos do diretório. Verifica as permissões do serviço e a configuração LDAP.' });
    const groupNames = [...new Set([...previous.map((item) => item.groupName), ...mappings.map((item) => item.groupName)])];
    const groups = new Map<string, { id: string; name: string }>();
    for (const name of groupNames) {
      const found = await this.request<{ id: string; name: string }[]>(`/groups?search=${encodeURIComponent(name)}&exact=true`);
      const exact = found.filter((item) => item.name === name);
      if (exact.length !== 1 && mappings.some((item) => item.groupName === name)) throw new BadGatewayException({ code: exact.length ? 'DIRECTORY_GROUP_AMBIGUOUS' : 'DIRECTORY_GROUP_NOT_SYNCED', message: exact.length ? `O grupo '${name}' não é único no Keycloak.` : `O grupo '${name}' ainda não foi sincronizado. Confirma o nome e a base de grupos LDAP.` });
      if (exact[0]) groups.set(name, exact[0]);
    }
    const roles = await Promise.all([...new Set([...previous, ...mappings].map((item) => item.appRole))].map((name) => this.request<KeycloakRole>(`/roles/${encodeURIComponent(name)}`)));
    const oldByGroup = new Map<string, string[]>();
    for (const entry of previous) oldByGroup.set(entry.groupName, [...(oldByGroup.get(entry.groupName) ?? []), entry.appRole]);
    const desiredByGroup = new Map<string, string[]>();
    for (const entry of mappings) desiredByGroup.set(entry.groupName, [...(desiredByGroup.get(entry.groupName) ?? []), entry.appRole]);
    for (const name of groupNames) {
      const group = groups.get(name); if (!group) continue;
      const path = `/groups/${encodeURIComponent(group.id)}/role-mappings/realm`;
      const [direct, available] = await Promise.all([this.request<KeycloakRole[]>(path), this.request<KeycloakRole[]>(`${path}/available`)]);
      const directNames = new Set(direct.map((role) => role.name)); const desired = desiredByGroup.get(name) ?? [];
      const remove = this.roleConfigRepresentations(direct, (oldByGroup.get(name) ?? []).filter((role) => !desired.includes(role)));
      const add = this.roleConfigRepresentations(available, desired.filter((role) => !directNames.has(role)));
      if (remove.length) await this.request<void>(path, { method: 'DELETE', body: JSON.stringify(remove) });
      if (add.length) await this.request<void>(path, { method: 'POST', body: JSON.stringify(add) });
      const verify = await this.request<KeycloakRole[]>(path);
      if (desired.some((role) => !verify.some((item) => item.name === role))) throw new BadGatewayException({ code: 'DIRECTORY_GROUP_ROLE_VERIFY_FAILED', message: `Keycloak não confirmou as roles do grupo '${name}'.` });
    }
  }
  async updateDirectoryFederation(input: UpdateDirectoryFederationDto, actor: AuthenticatedUser) {
    this.assertSecureDirectoryConfig(input);
    await this.testDirectoryConnection(input);
    const components = await this.directoryComponents();
    let provider = components.find((item) => item.name === this.directoryProviderName);
    let mapper = provider ? (await this.directoryComponents(provider.id)).find((item) => item.name === this.directoryMapperName) : undefined;
    let previousMappings: { groupName: string; appRole: string }[] = [];
    try { const parsed = JSON.parse(this.configValue(mapper ?? ({} as KeycloakComponent), 'app.groupRoleMappings')); if (Array.isArray(parsed)) previousMappings = parsed; } catch { /* No previously managed mappings. */ }
    if (!input.bindCredential) throw new BadGatewayException({ code: 'DIRECTORY_BIND_CREDENTIAL_REQUIRED', message: 'Volta a indicar a credencial de serviço ao guardar a configuração.' });
    const providerConfig = this.componentConfig({
      enabled: true, priority: 0, vendor: input.vendor, usernameLDAPAttribute: input.usernameLdapAttribute, rdnLDAPAttribute: input.vendor === 'ad' ? 'cn' : input.usernameLdapAttribute,
      uuidLDAPAttribute: input.vendor === 'ad' ? 'objectGUID' : 'entryUUID', userObjectClasses: input.vendor === 'ad' ? 'person, organizationalPerson, user' : 'inetOrgPerson, organizationalPerson', connectionUrl: input.connectionUrl,
      usersDn: input.usersDn, authType: 'simple', bindDn: input.bindDn, importEnabled: true, editMode: 'READ_ONLY',
      syncRegistrations: false, useTruststoreSpi: 'ldapsOnly', connectionTimeout: 10000, pagination: true,
    });
    providerConfig.bindCredential = [input.bindCredential];
    const providerBody: KeycloakComponent = { name: this.directoryProviderName, providerId: 'ldap', providerType: 'org.keycloak.storage.UserStorageProvider', config: providerConfig, ...(provider?.id ? { id: provider.id } : {}) };
    if (provider?.id) { await this.request<void>(`/components/${encodeURIComponent(provider.id)}`, { method: 'PUT', body: JSON.stringify(providerBody) }); provider = { ...provider, ...providerBody }; }
    else { provider = await this.request<KeycloakComponent>('/components', { method: 'POST', body: JSON.stringify(providerBody) }); if (!provider?.id) { const refreshed = await this.directoryComponents(); provider = refreshed.find((item) => item.name === this.directoryProviderName); } }
    if (!provider?.id) throw new BadGatewayException({ code: 'DIRECTORY_PROVIDER_SAVE_FAILED', message: 'Keycloak não confirmou a configuração LDAP.' });
    const mapperBody: KeycloakComponent = { name: this.directoryMapperName, providerId: 'group-ldap-mapper', providerType: 'org.keycloak.storage.ldap.mappers.LDAPStorageMapper', parentId: provider.id, config: this.componentConfig({
      'groups.dn': input.groupsDn, 'group.name.ldap.attribute': input.groupNameLdapAttribute, 'group.object.classes': input.groupObjectClass,
      'membership.ldap.attribute': input.membershipLdapAttribute, 'membership.attribute.type': input.membershipLdapAttribute === 'memberUid' ? 'UID' : 'DN',
      'membership.user.ldap.attribute': input.usernameLdapAttribute, 'groups.ldap.filter': '', 'mode': 'READ_ONLY',
      'user.roles.retrieve.strategy': 'LOAD_GROUPS_BY_MEMBER_ATTRIBUTE', 'preserve.group.inheritance': true,
      'drop.non.existing.groups.during.sync': false, 'app.groupRoleMappings': JSON.stringify(input.groupRoleMappings.map((item) => ({ groupName: item.groupName.trim(), appRole: item.appRole }))),
    }), ...(mapper?.id ? { id: mapper.id } : {}) };
    if (mapper?.id) { await this.request<void>(`/components/${encodeURIComponent(mapper.id)}`, { method: 'PUT', body: JSON.stringify(mapperBody) }); mapper = { ...mapper, ...mapperBody }; }
    else { mapper = await this.request<KeycloakComponent>('/components', { method: 'POST', body: JSON.stringify(mapperBody) }); if (!mapper?.id) { const refreshed = await this.directoryComponents(provider.id); mapper = refreshed.find((item) => item.name === this.directoryMapperName); } }
    if (!mapper?.id) throw new BadGatewayException({ code: 'DIRECTORY_GROUP_MAPPER_SAVE_FAILED', message: 'Keycloak não confirmou o mapeador dos grupos LDAP.' });
    await this.reconcileDirectoryGroupRoles(mapper, input.groupRoleMappings.map((item) => ({ groupName: item.groupName.trim(), appRole: item.appRole })), previousMappings);
    await this.audit.record({ userId: actor.id, action: 'DIRECTORY_FEDERATION_UPDATED', entityType: 'KeycloakUserStorageProvider', entityId: provider.id, metadata: { connectionUrl: input.connectionUrl, usersDn: input.usersDn, groupsDn: input.groupsDn, groupRoleMappings: input.groupRoleMappings } });
    return this.directoryStatus(provider, mapper);
  }
  private async roleSets(userId: string) {
    const encoded = encodeURIComponent(userId);
    const [direct, effective] = await Promise.all([this.request<KeycloakRole[]>(`/users/${encoded}/role-mappings/realm`), this.request<KeycloakRole[]>(`/users/${encoded}/role-mappings/realm/composite`)]);
    const directRoles = direct.map((role) => role.name).filter(isApplicationRole);
    const effectiveRoles = effective.map((role) => role.name).filter(isApplicationRole);
    return { directRoles, effectiveRoles, inheritedRoles: effectiveRoles.filter((role) => !directRoles.includes(role)) };
  }
  async effectiveRoles(externalId: string) { return (await this.roleSets(externalId)).effectiveRoles; }
  async listUsers(searchText?: string, pageText?: string, pageSizeText?: string) {
    const page = Math.max(Number(pageText) || 1, 1); const pageSize = Math.min(Math.max(Number(pageSizeText) || 20, 1), 50); const search = searchText?.trim();
    const query = new URLSearchParams({ first: String((page - 1) * pageSize), max: String(pageSize), ...(search ? { search } : {}) }); const countQuery = new URLSearchParams(search ? { search } : {});
    const [rawUsers, countResult] = await Promise.all([this.request<KeycloakUser[]>(`/users?${query}`), this.request<number>(`/users/count?${countQuery}`)]);
    const users = rawUsers.filter((item) => !item.serviceAccountClientId && !item.username?.startsWith('service-account-'));
    const items = await Promise.all(users.map(async (item) => ({ externalId: item.id, username: item.username ?? '', displayName: [item.firstName, item.lastName].filter(Boolean).join(' ') || item.username || '', email: item.email ?? null, enabled: item.enabled !== false, ...(await this.roleSets(item.id)) })));
    return { items, page, pageSize, total: countResult, totalPages: Math.max(1, Math.ceil(countResult / pageSize)) };
  }
  private async roleRepresentations(externalId: string) {
    const path = `/users/${encodeURIComponent(externalId)}/role-mappings/realm`;
    const [direct, available] = await Promise.all([
      this.request<KeycloakRole[]>(path),
      this.request<KeycloakRole[]>(`${path}/available`),
    ]);
    const roles = [...direct, ...available].filter((role) => isApplicationRole(role.name));
    return new Map(roles.map((role) => [role.name as ApplicationRole, role]));
  }
  private async assertAnotherAdmin(targetUserId: string) {
    // Keycloak protects the role-members endpoint with `view-users`. Listing
    // users and their effective mappings works with the narrower `query-users`
    // permission already granted to this service account.
    const users = await this.request<KeycloakUser[]>('/users?briefRepresentation=true&first=0&max=1000');
    const candidates = users.filter((item) => item.id !== targetUserId && item.enabled !== false && !item.serviceAccountClientId && !item.username?.startsWith('service-account-'));
    const roles = await Promise.all(candidates.map((item) => this.roleSets(item.id)));
    if (!roles.some((item) => item.effectiveRoles.includes('ADMIN'))) throw new ConflictException({ code: 'LAST_ADMIN_REQUIRED', message: 'Não é possível remover a role do último administrador ativo.' });
  }
  private async restoreDirectRoles(externalId: string, expected: ApplicationRole[], roleMap: Map<ApplicationRole, KeycloakRole>) {
    const current = await this.roleSets(externalId); const path = `/users/${encodeURIComponent(externalId)}/role-mappings/realm`;
    const missing = expected.filter((role) => !current.directRoles.includes(role)).map((role) => roleMap.get(role)!);
    const extra = current.directRoles.filter((role) => !expected.includes(role)).map((role) => roleMap.get(role)!);
    if (missing.length) await this.request<void>(path, { method: 'POST', body: JSON.stringify(missing) });
    if (extra.length) await this.request<void>(path, { method: 'DELETE', body: JSON.stringify(extra) });
  }
  async updateRoles(externalId: string, desiredInput: ApplicationRole[], actor: AuthenticatedUser) {
    const desired = [...new Set(desiredInput)]; const before = await this.roleSets(externalId); const effectiveAfter = [...new Set([...before.inheritedRoles, ...desired])];
    if (!effectiveAfter.length) throw new ConflictException({ code: 'APPLICATION_ROLE_REQUIRED', message: 'O utilizador tem de manter pelo menos uma role da aplicação.' });
    if (before.effectiveRoles.includes('ADMIN') && !effectiveAfter.includes('ADMIN')) await this.assertAnotherAdmin(externalId);
    const roleMap = await this.roleRepresentations(externalId); const added = desired.filter((role) => !before.directRoles.includes(role)).map((role) => roleMap.get(role)!); const removed = before.directRoles.filter((role) => !desired.includes(role)).map((role) => roleMap.get(role)!); const path = `/users/${encodeURIComponent(externalId)}/role-mappings/realm`;
    let verified;
    try {
      if (added.length) await this.request<void>(path, { method: 'POST', body: JSON.stringify(added) });
      if (removed.length) await this.request<void>(path, { method: 'DELETE', body: JSON.stringify(removed) });
      verified = await this.roleSets(externalId);
      const expected = [...desired].sort(); const actual = [...verified.directRoles].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new BadGatewayException({ code: 'KEYCLOAK_ROLE_VERIFICATION_FAILED', message: 'O Keycloak não confirmou as roles pedidas.' });
    } catch (error) {
      await this.restoreDirectRoles(externalId, before.directRoles, roleMap).catch(() => undefined);
      throw error;
    }
    await this.request<void>(`/users/${encodeURIComponent(externalId)}/logout`, { method: 'POST' });
    await this.audit.record({ userId: actor.id, action: 'USER_ROLES_UPDATED', entityType: 'User', entityId: externalId, metadata: { previousDirectRoles: before.directRoles, nextDirectRoles: desired, inheritedRoles: before.inheritedRoles } });
    return { externalId, directRoles: verified.directRoles, inheritedRoles: verified.inheritedRoles, effectiveRoles: verified.effectiveRoles, reauthenticationRequired: actor.externalId === externalId };
  }

  /** Add roles for the request workflow without replacing mappings or logging the user out. */
  async grantRoles(externalId: string, requested: ApplicationRole[]) {
    const before = await this.roleSets(externalId);
    const roleMap = await this.roleRepresentations(externalId);
    const additions = requested.filter((role) => !before.effectiveRoles.includes(role)).map((role) => roleMap.get(role)!);
    const path = `/users/${encodeURIComponent(externalId)}/role-mappings/realm`;
    if (additions.length) await this.request<void>(path, { method: 'POST', body: JSON.stringify(additions) });
    const verified = await this.roleSets(externalId);
    if (requested.some((role) => !verified.effectiveRoles.includes(role))) throw new BadGatewayException({ code: 'KEYCLOAK_ROLE_VERIFICATION_FAILED', message: 'O Keycloak não confirmou as roles pedidas.' });
    return verified;
  }
}
