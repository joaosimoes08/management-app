'use client';

import type { KeycloakProfile } from 'keycloak-js';
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, setApiTokenProvider, setApiUnauthorizedHandler } from '@/lib/api/client';
import { fetchCurrentUser } from './api';
import { getKeycloakInstance, initializeKeycloak } from './keycloak';
import type { ApiUser, AuthContextValue, SetupStatus } from './types';
import { getFormatLocale } from '@/lib/format/date';
import { translateMessage } from '@/lib/i18n/i18n';

/** Sign-in texts in the active app language (I18nProvider keeps the format locale in sync). */
const authText = (key: string) => translateMessage(getFormatLocale(), key);

const isUnauthorized = (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401;

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [profile, setProfile] = useState<KeycloakProfile | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupStatusError, setSetupStatusError] = useState<string | null>(null);
  const refreshTimer = useRef<number | undefined>(undefined);
  const tokenRefreshPromise = useRef<Promise<string> | null>(null);
  const keycloakRef = useRef<ReturnType<typeof getKeycloakInstance> | null>(null);

  const loadIdentity = useCallback(async () => {
    setUser(await fetchCurrentUser());
  }, []);

  const refreshToken = useCallback(async (): Promise<string> => {
    const keycloak = keycloakRef.current;
    if (!keycloak?.authenticated || !keycloak.token) throw new Error(authText('shell.auth.notAuthenticated'));
    if (!tokenRefreshPromise.current) {
      tokenRefreshPromise.current = (async () => {
        let refreshed: boolean;
        let accessToken: string;
        try {
          refreshed = await keycloak.updateToken(60);
          const nextToken = keycloak.token;
          if (!nextToken) throw new Error(authText('shell.auth.noAccessToken'));
          accessToken = nextToken;
        } catch (error) {
          setAuthError(authText('shell.auth.sessionExpired'));
          await keycloak.logout({ redirectUri: window.location.origin });
          throw error;
        }
        // Not awaited: the identity request asks this same provider for its token, and awaiting
        // it here would wait on the refresh it is part of. It gets this refresh's token.
        if (refreshed) void loadIdentity().catch(() => undefined);
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
      const keycloak = keycloakRef.current;
      if (keycloak) void keycloak.login({ redirectUri: window.location.href, scope: 'openid profile email' });
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
        setAuthError(authText('shell.auth.keycloakUnreachable'));
        setLoading(false);
      }
    }, 10000);
    void initializeKeycloak()
      .then(async (isAuthenticated) => {
        if (!active) return;
        const keycloak = getKeycloakInstance();
        keycloakRef.current = keycloak;
        keycloak.onTokenExpired = () => { void refreshToken().catch(() => undefined); };
        keycloak.onAuthLogout = () => { setAuthenticated(false); setUser(null); };
        setAuthError(null);
        setAuthenticated(isAuthenticated);
        if (isAuthenticated) {
          // Profile, API identity and setup status only need the access token, so they load
          // together instead of one after another. `loading` stays true until all three settle,
          // which keeps the gate and the locale on one decision and mounts the app once.
          const accessToken = keycloak.token;
          const [profileResult, identityResult, setupResult] = await Promise.allSettled([
            keycloak.loadUserProfile(),
            accessToken ? loadIdentity() : Promise.reject(new Error(authText('shell.auth.noAccessToken'))),
            accessToken ? apiFetch<SetupStatus>('/api/v1/setup/status', { redirectOnUnauthorized: false }) : Promise.reject(new Error(authText('shell.auth.noAccessToken'))),
          ]);
          if (!active) return;
          // The API identity is authoritative for application access. A profile endpoint
          // failure must not turn a valid Keycloak session into a login loop.
          setProfile(profileResult.status === 'fulfilled' ? profileResult.value : null);
          // A 401 on either call means the API does not accept this session: show the sign-in screen
          // instead of restarting the Keycloak login, which would bounce a valid Keycloak session.
          if (identityResult.status === 'rejected' || (setupResult.status === 'rejected' && isUnauthorized(setupResult.reason))) {
            setAuthenticated(false);
            setUser(null);
          } else if (setupResult.status === 'fulfilled') {
            setSetupStatus(setupResult.value);
            setSetupStatusError(null);
          } else {
            setSetupStatus(null);
            setSetupStatusError(setupResult.reason instanceof Error ? setupResult.reason.message : authText('shell.auth.setupCheckFailed'));
          }
        }
      })
      .catch(() => { if (active) { setAuthenticated(false); setAuthError(authText('shell.auth.startFailed')); } })
      .finally(() => { window.clearTimeout(initTimeout); if (active) setLoading(false); });

    refreshTimer.current = window.setInterval(() => { void refreshToken().catch(() => undefined); }, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initTimeout);
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
    };
  }, [loadIdentity, refreshToken]);

  const login = useCallback(async () => {
    await initializeKeycloak();
    const keycloak = keycloakRef.current ?? getKeycloakInstance();
    await keycloak.login({ redirectUri: window.location.origin, scope: 'openid profile email' });
  }, []);
  const logout = useCallback(async () => {
    await initializeKeycloak();
    const keycloak = keycloakRef.current ?? getKeycloakInstance();
    await keycloak.logout({ redirectUri: window.location.origin });
  }, []);
  const retry = useCallback(() => window.location.reload(), []);
  const hasRole = useCallback((role: string) => user?.roles.includes(role) ?? false, [user]);

  const value = useMemo<AuthContextValue>(() => ({ user, profile, loading, authError, authenticated, setupStatus, setupStatusError, login, logout, retry, hasRole }), [user, profile, loading, authError, authenticated, setupStatus, setupStatusError, login, logout, retry, hasRole]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
