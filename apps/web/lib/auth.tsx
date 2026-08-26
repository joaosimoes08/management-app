'use client';

import Keycloak, { KeycloakInstance, KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type ApiUser = {
  id: string;
  externalId: string;
  username: string;
  roles: string[];
};

type AuthContextValue = {
  keycloak: KeycloakInstance | null;
  user: ApiUser | null;
  profile: KeycloakProfile | null;
  token: string | undefined;
  loading: boolean;
  authError: string | null;
  authenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
  hasRole: (role: string) => boolean;
  apiFetch: <T = any>(path: string, init?: RequestInit) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const localizedApiErrors: Record<string, Record<string, string>> = {
  'pt-PT': {
    APPLICATION_ROLE_REQUIRED: 'O utilizador tem de manter pelo menos uma role da aplicação.',
    KEYCLOAK_ADMIN_AUTH_FAILED: 'Não foi possível autenticar o serviço administrativo no Keycloak.',
    KEYCLOAK_ADMIN_NOT_CONFIGURED: 'A integração administrativa do Keycloak não está configurada.',
    KEYCLOAK_ADMIN_REQUEST_FAILED: 'O Keycloak recusou a operação administrativa.',
    LAST_ADMIN_REQUIRED: 'Não é possível remover a role do último administrador ativo.',
    SITE_NOT_EMPTY: 'Só é possível eliminar Sites vazios.',
    TCP_PORT_REQUIRED: 'Define pelo menos uma porta para Discovery TCP.',
    DISCOVERY_TARGET_FORBIDDEN: 'A rede pertence ou sobrepõe uma gama especial bloqueada.',
    DISCOVERY_TARGET_NOT_ALLOWED: 'A subnet não está incluída nas redes autorizadas para Discovery.',
    DISCOVERY_IPV6_UNSUPPORTED: 'A enumeração de subnets IPv6 ainda não é suportada.',
    DISCOVERY_PORT_LIMIT: 'Discovery aceita no máximo 64 portas por execução.',
    DISCOVERY_ALREADY_ACTIVE: 'Já existe uma execução ativa para esta subnet.',
    IPAM_SCOPE_FORBIDDEN: 'Não tens permissão para esta operação neste scope IPAM.',
    IPAM_SCOPE_SITE_MISMATCH: 'O scope não pertence ao Site do grupo.',
    IPAM_PLACEMENT_SITE_MISMATCH: 'Site, VLAN, VRF e subnet pai têm de pertencer ao mesmo Site.',
    SERVICE_PORT_REQUIRED: 'Services TCP/UDP exigem uma porta.',
    DEVICE_HOST_CONFLICT: 'O equipamento já está associado a outro Host.',
    VALIDATION_ERROR: 'Existem campos inválidos no pedido.',
  },
  'en-US': {
    APPLICATION_ROLE_REQUIRED: 'The user must retain at least one application role.',
    KEYCLOAK_ADMIN_AUTH_FAILED: 'The Keycloak administration service could not authenticate.',
    KEYCLOAK_ADMIN_NOT_CONFIGURED: 'The Keycloak administration integration is not configured.',
    KEYCLOAK_ADMIN_REQUEST_FAILED: 'Keycloak rejected the administrative operation.',
    LAST_ADMIN_REQUIRED: 'The role cannot be removed from the last active administrator.',
    SITE_NOT_EMPTY: 'Only empty Sites can be deleted.',
    TCP_PORT_REQUIRED: 'Define at least one port for TCP Discovery.',
    DISCOVERY_TARGET_FORBIDDEN: 'The network belongs to or overlaps a blocked special range.',
    DISCOVERY_TARGET_NOT_ALLOWED: 'The subnet is not included in the Discovery allowlist.',
    DISCOVERY_IPV6_UNSUPPORTED: 'IPv6 subnet enumeration is not supported yet.',
    DISCOVERY_PORT_LIMIT: 'Discovery accepts at most 64 ports per run.',
    DISCOVERY_ALREADY_ACTIVE: 'There is already an active run for this subnet.',
    IPAM_SCOPE_FORBIDDEN: 'You do not have permission for this operation in this IPAM scope.',
    IPAM_SCOPE_SITE_MISMATCH: 'The scope does not belong to the group Site.',
    IPAM_PLACEMENT_SITE_MISMATCH: 'Site, VLAN, VRF, and parent subnet must belong to the same Site.',
    SERVICE_PORT_REQUIRED: 'TCP/UDP Services require a port.',
    DEVICE_HOST_CONFLICT: 'The device is already linked to another Host.',
    VALIDATION_ERROR: 'The request contains invalid fields.',
  },
};

const keycloak = new Keycloak({
  url: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8080',
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? 'COCiber',
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'simoes-web',
});

let keycloakInitPromise: Promise<boolean> | null = null;

function initializeKeycloak() {
  if (!keycloakInitPromise) {
    keycloakInitPromise = keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      checkLoginIframe: false,
      pkceMethod: 'S256',
    }).catch((error) => {
      keycloakInitPromise = null;
      throw error;
    });
  }
  return keycloakInitPromise;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [profile, setProfile] = useState<KeycloakProfile | null>(null);
  const [token, setToken] = useState<string>();
  const refreshTimer = useRef<number | undefined>(undefined);

  const loadIdentity = useCallback(async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${keycloak.token}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Falha ao carregar identidade (${response.status})`);
    setUser(await response.json() as ApiUser);
  }, []);

  const refreshToken = useCallback(async () => {
    if (!keycloak.authenticated) return;
    try {
      await keycloak.updateToken(60);
      setToken(keycloak.token);
      if (typeof window !== 'undefined' && keycloak.token) localStorage.setItem('cociber.token', keycloak.token);
      await loadIdentity();
    } catch {
      setAuthError('A sessão expirou.');
      await keycloak.logout({ redirectUri: window.location.origin });
    }
  }, [loadIdentity]);

  useEffect(() => {
    let active = true;
    const initTimeout = window.setTimeout(() => {
      if (active) {
        setAuthError('Não foi possível contactar o Keycloak.');
        setLoading(false);
      }
    }, 10000);
    keycloak.onTokenExpired = () => { void refreshToken(); };
    keycloak.onAuthLogout = () => { setAuthenticated(false); setUser(null); setToken(undefined); };

    void initializeKeycloak()
      .then(async (isAuthenticated) => {
        if (!active) return;
        setAuthError(null);
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token);
        if (typeof window !== 'undefined' && keycloak.token) localStorage.setItem('cociber.token', keycloak.token);
        if (isAuthenticated) {
          try {
            setProfile(await keycloak.loadUserProfile());
          } catch {
            // The API identity is authoritative for application access. A
            // profile endpoint failure must not turn a valid Keycloak session
            // into a login loop.
            setProfile(null);
          }
          try {
            await loadIdentity();
          } catch {
            setAuthenticated(false);
            setUser(null);
          }
        }
      })
      .catch(() => { if (active) { setAuthenticated(false); setAuthError('Não foi possível iniciar a autenticação.'); } })
      .finally(() => { window.clearTimeout(initTimeout); if (active) setLoading(false); });

    refreshTimer.current = window.setInterval(() => { void refreshToken(); }, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initTimeout);
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    };
  }, [loadIdentity, refreshToken]);

  const login = useCallback(() => keycloak.login({ redirectUri: window.location.origin, scope: 'openid profile email' }), []);
  const logout = useCallback(() => keycloak.logout({ redirectUri: window.location.origin }), []);
  const retry = useCallback(() => window.location.reload(), []);
  const hasRole = useCallback((role: string) => user?.roles.includes(role) ?? false, [user]);
  const apiFetch = useCallback(async <T = any,>(path: string, init: RequestInit = {}) => {
    if (typeof window !== 'undefined') (window as any).__cociberApiFetch = apiFetch;
    await refreshToken();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const headers = {
      ...init.headers,
      Authorization: `Bearer ${keycloak.token}`,
      'Accept-Language': typeof window !== 'undefined' ? (window.localStorage.getItem('cociber.locale') ?? 'pt-PT') : 'pt-PT',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers,
    });
    if (response.status === 401) { await keycloak.login({ redirectUri: window.location.href, scope: 'openid profile email' }); throw new Error('Sessão expirada'); }
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json() as { code?: string; message?: string | string[]; error?: string };
        const locale = window.localStorage.getItem('cociber.locale') === 'en-US' ? 'en-US' : 'pt-PT';
        detail = (payload.code && localizedApiErrors[locale][payload.code]) || (Array.isArray(payload.message) ? payload.message.join(', ') : payload.message ?? payload.error ?? '');
      } catch {
        // Keep the status as a useful fallback when the API did not return JSON.
      }
      throw new Error(detail || `Pedido falhou (${response.status})`);
    }
    const responseText = await response.text();
    return (responseText ? JSON.parse(responseText) : undefined) as T;
  }, [refreshToken]);

  const value = useMemo(() => ({ keycloak, user, profile, token, loading, authError, authenticated, login, logout, retry, hasRole, apiFetch }), [user, profile, token, loading, authError, authenticated, login, logout, retry, hasRole, apiFetch]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}

export type { ApiUser, KeycloakTokenParsed };
