import Keycloak from 'keycloak-js';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';

let keycloak: Keycloak | null = null;

let keycloakInitPromise: Promise<boolean> | null = null;

export function initializeKeycloak(): Promise<boolean> {
  if (!keycloakInitPromise) {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('Keycloak can only be initialized in the browser.'));
    }
    const publicConfig = getPublicRuntimeConfig();
    keycloak = new Keycloak({
      url: publicConfig.keycloakUrl,
      realm: publicConfig.keycloakRealm,
      clientId: publicConfig.keycloakClientId,
    });
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

export function getKeycloakInstance(): Keycloak {
  if (!keycloak) throw new Error('Keycloak has not been initialized.');
  return keycloak;
}
