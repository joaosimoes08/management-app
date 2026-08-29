import type { KeycloakInstance, KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';

export type ApiUser = {
  id: string;
  externalId: string;
  username: string;
  roles: string[];
};

export type AuthContextValue = {
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
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
};

export type { KeycloakProfile, KeycloakTokenParsed };
