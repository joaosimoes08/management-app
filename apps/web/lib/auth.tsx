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

const keycloak = new Keycloak({
  url: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8080',
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? 'COCiber',
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'simoes-web',
});

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

  void keycloak.init({ onLoad: 'check-sso', silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`, checkLoginIframe: false, pkceMethod: 'S256' })
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
        const payload = await response.json() as { message?: string | string[]; error?: string };
        detail = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message ?? payload.error ?? '';
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
