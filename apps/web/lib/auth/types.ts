import type { KeycloakInstance, KeycloakProfile, KeycloakTokenParsed } from 'keycloak-js';

export type ApiUser = {
  id: string;
  externalId: string;
  username: string;
  roles: string[];
};

/** GET /api/v1/setup/status, loaded once with the identity on sign-in (fields the web app reads). */
export type SetupStatus = {
  setupCompleted: boolean;
  organizationName?: string | null;
  locale?: string | null;
};

export type AuthContextValue = {
  keycloak: KeycloakInstance | null;
  user: ApiUser | null;
  profile: KeycloakProfile | null;
  token: string | undefined;
  loading: boolean;
  authError: string | null;
  authenticated: boolean;
  /** Setup status for the signed-in session; null before sign-in or when the request failed. */
  setupStatus: SetupStatus | null;
  /** Message when the setup status could not be loaded for a signed-in session. */
  setupStatusError: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
  hasRole: (role: string) => boolean;
};

export type { KeycloakProfile, KeycloakTokenParsed };
