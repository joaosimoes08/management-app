'use client';

import type { KeycloakProfile } from 'keycloak-js';
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch as apiFetchClient, setApiTokenProvider, setApiUnauthorizedHandler } from '@/lib/api/client';
import { keycloak, initializeKeycloak } from './keycloak';
import type { ApiUser, AuthContextValue } from './types';

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [profile, setProfile] = useState<KeycloakProfile | null>(null);
  const [token, setToken] = useState<string>();
  const refreshTimer = useRef<number | undefined>(undefined);
  const tokenRefreshPromise = useRef<Promise<string> | null>(null);

  const loadIdentity = useCallback(async (accessToken: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Falha ao carregar identidade (${response.status})`);
    setUser(await response.json() as ApiUser);
  }, []);

  const refreshToken = useCallback(async (): Promise<string> => {
    if (!keycloak.authenticated || !keycloak.token) throw new Error('Sessão não autenticada.');
    if (!tokenRefreshPromise.current) {
      tokenRefreshPromise.current = (async () => {
        let refreshed: boolean;
        let accessToken: string;
        try {
          refreshed = await keycloak.updateToken(60);
          const nextToken = keycloak.token;
          if (!nextToken) throw new Error('O Keycloak não devolveu um access token.');
          accessToken = nextToken;
          setToken(nextToken);
        } catch (error) {
          setAuthError('A sessão expirou.');
          await keycloak.logout({ redirectUri: window.location.origin });
          throw error;
        }
        if (refreshed) await loadIdentity(accessToken).catch(() => undefined);
        return accessToken;
      })().finally(() => { tokenRefreshPromise.current = null; });
    }
    return tokenRefreshPromise.current;
  }, [loadIdentity]);

  // Bridge auth → API transport: the client module only ever sees a token
  // provider and an unauthorized callback, never the Keycloak adapter.
  useEffect(() => {
    setApiTokenProvider(refreshToken);
    setApiUnauthorizedHandler(() => {
      void keycloak.login({ redirectUri: window.location.href, scope: 'openid profile email' });
    });
    return () => {
      setApiTokenProvider(null);
      setApiUnauthorizedHandler(null);
    };
  }, [refreshToken]);

  useEffect(() => {
    let active = true;
    const initTimeout = window.setTimeout(() => {
      if (active) {
        setAuthError('Não foi possível contactar o Keycloak.');
        setLoading(false);
      }
    }, 10000);
    keycloak.onTokenExpired = () => { void refreshToken().catch(() => undefined); };
    keycloak.onAuthLogout = () => { setAuthenticated(false); setUser(null); setToken(undefined); };

    void initializeKeycloak()
      .then(async (isAuthenticated) => {
        if (!active) return;
        setAuthError(null);
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token);
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
            if (!keycloak.token) throw new Error('O Keycloak não devolveu um access token.');
            await loadIdentity(keycloak.token);
          } catch {
            setAuthenticated(false);
            setUser(null);
          }
        }
      })
      .catch(() => { if (active) { setAuthenticated(false); setAuthError('Não foi possível iniciar a autenticação.'); } })
      .finally(() => { window.clearTimeout(initTimeout); if (active) setLoading(false); });

    refreshTimer.current = window.setInterval(() => { void refreshToken().catch(() => undefined); }, 30_000);
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
  // Temporary passthrough so pre-existing consumers keep working while they
  // migrate to domain API functions; removed once no consumer remains.
  const apiFetch = apiFetchClient;

  const value = useMemo(() => ({ keycloak, user, profile, token, loading, authError, authenticated, login, logout, retry, hasRole, apiFetch }), [user, profile, token, loading, authError, authenticated, login, logout, retry, hasRole, apiFetch]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
