export interface PublicRuntimeConfig {
  apiUrl?: string;
  keycloakUrl?: string;
  keycloakRealm?: string;
  keycloakClientId?: string;
  bookstackUrl?: string;
  organizationName?: string;
  locale?: string;
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
    bookstackUrl: runtime?.bookstackUrl ?? process.env.NEXT_PUBLIC_BOOKSTACK_URL ?? '',
    organizationName: runtime?.organizationName ?? process.env.NEXT_PUBLIC_ORGANIZATION_NAME ?? '',
    locale: runtime?.locale ?? process.env.NEXT_PUBLIC_APP_LOCALE ?? 'pt-PT',
  };
}

export function getPublicOrganizationName() {
  const config = getPublicRuntimeConfig();
  return config.organizationName.trim() || config.keycloakRealm;
}

export function getConfiguredLocale(): 'pt-PT' | 'en-US' {
  return getPublicRuntimeConfig().locale === 'en-US' ? 'en-US' : 'pt-PT';
}

export function hasSavedOrganizationLocale(status: { setupCompleted: boolean; organizationName?: string | null }) {
  return status.setupCompleted || Boolean(status.organizationName?.trim());
}

export function resolveOrganizationLocale(
  status: { setupCompleted: boolean; organizationName?: string | null; locale?: string | null },
  deploymentLocale: 'pt-PT' | 'en-US',
): 'pt-PT' | 'en-US' {
  if (hasSavedOrganizationLocale(status) && (status.locale === 'pt-PT' || status.locale === 'en-US')) return status.locale;
  return deploymentLocale;
}
