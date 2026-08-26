import { BadGatewayException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { APPLICATION_ROLES, ApplicationRole, isApplicationRole } from '../auth/roles';
import { AuthenticatedUser } from '../auth/auth.service';

type KeycloakUser = { id: string; username?: string; firstName?: string; lastName?: string; email?: string; enabled?: boolean; serviceAccountClientId?: string };
type KeycloakRole = { id: string; name: string; description?: string; composite?: boolean; clientRole?: boolean };

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
    if (!response.ok) { const detail = await response.text().catch(() => ''); throw new BadGatewayException({ code: 'KEYCLOAK_ADMIN_REQUEST_FAILED', message: 'O Keycloak recusou a operação administrativa.', detail: detail.slice(0, 300) }); }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  private async roleSets(userId: string) {
    const encoded = encodeURIComponent(userId);
    const [direct, effective] = await Promise.all([this.request<KeycloakRole[]>(`/users/${encoded}/role-mappings/realm`), this.request<KeycloakRole[]>(`/users/${encoded}/role-mappings/realm/composite`)]);
    const directRoles = direct.map((role) => role.name).filter(isApplicationRole);
    const effectiveRoles = effective.map((role) => role.name).filter(isApplicationRole);
    return { directRoles, effectiveRoles, inheritedRoles: effectiveRoles.filter((role) => !directRoles.includes(role)) };
  }
  async listUsers(searchText?: string, pageText?: string, pageSizeText?: string) {
    const page = Math.max(Number(pageText) || 1, 1); const pageSize = Math.min(Math.max(Number(pageSizeText) || 20, 1), 50); const search = searchText?.trim();
    const query = new URLSearchParams({ first: String((page - 1) * pageSize), max: String(pageSize), ...(search ? { search } : {}) }); const countQuery = new URLSearchParams(search ? { search } : {});
    const [rawUsers, countResult] = await Promise.all([this.request<KeycloakUser[]>(`/users?${query}`), this.request<number>(`/users/count?${countQuery}`)]);
    const users = rawUsers.filter((item) => !item.serviceAccountClientId && !item.username?.startsWith('service-account-'));
    const items = await Promise.all(users.map(async (item) => ({ externalId: item.id, username: item.username ?? '', displayName: [item.firstName, item.lastName].filter(Boolean).join(' ') || item.username || '', email: item.email ?? null, enabled: item.enabled !== false, ...(await this.roleSets(item.id)) })));
    return { items, page, pageSize, total: countResult, totalPages: Math.max(1, Math.ceil(countResult / pageSize)) };
  }
  private async roleRepresentations() { const roles = await Promise.all(APPLICATION_ROLES.map((role) => this.request<KeycloakRole>(`/roles/${encodeURIComponent(role)}`))); return new Map(roles.map((role) => [role.name as ApplicationRole, role])); }
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
    const roleMap = await this.roleRepresentations(); const added = desired.filter((role) => !before.directRoles.includes(role)).map((role) => roleMap.get(role)!); const removed = before.directRoles.filter((role) => !desired.includes(role)).map((role) => roleMap.get(role)!); const path = `/users/${encodeURIComponent(externalId)}/role-mappings/realm`;
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
}
