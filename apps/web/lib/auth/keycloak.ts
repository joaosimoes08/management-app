import Keycloak from 'keycloak-js';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';

const publicConfig = getPublicRuntimeConfig();

export const keycloak = new Keycloak({
  url: publicConfig.keycloakUrl,
  realm: publicConfig.keycloakRealm,
  clientId: publicConfig.keycloakClientId,
});

let keycloakInitPromise: Promise<boolean> | null = null;

export function initializeKeycloak(): Promise<boolean> {
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
