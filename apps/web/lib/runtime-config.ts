export interface PublicRuntimeConfig {
  apiUrl?: string;
  keycloakUrl?: string;
  keycloakRealm?: string;
  keycloakClientId?: string;
}

declare global {
  interface Window {
    __COCIBER_CONFIG__?: PublicRuntimeConfig;
  }
}

export function getPublicRuntimeConfig(): Required<PublicRuntimeConfig> {
  const runtime = typeof window === 'undefined' ? undefined : window.__COCIBER_CONFIG__;
  return {
    apiUrl: runtime?.apiUrl ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    keycloakUrl: runtime?.keycloakUrl ?? process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8080',
    keycloakRealm: runtime?.keycloakRealm ?? process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? 'COCiber',
    keycloakClientId: runtime?.keycloakClientId ?? process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'simoes-web',
  };
}
