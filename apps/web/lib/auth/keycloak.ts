import Keycloak from 'keycloak-js';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';

let keycloak: Keycloak | null = null;

let keycloakInitPromise: Promise<boolean> | null = null;

function createKeycloak(): Keycloak {
  const publicConfig = getPublicRuntimeConfig();
  return new Keycloak({
    url: publicConfig.keycloakUrl,
    realm: publicConfig.keycloakRealm,
    clientId: publicConfig.keycloakClientId,
  });
}

function initInstance(instance: Keycloak): Promise<boolean> {
  return instance.init({
    onLoad: 'check-sso',
    silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    checkLoginIframe: false,
    pkceMethod: 'S256',
  });
}

export function initializeKeycloak(): Promise<boolean> {
  if (!keycloakInitPromise) {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('Keycloak can only be initialized in the browser.'));
    }
    keycloak = createKeycloak();
    keycloakInitPromise = initInstance(keycloak)
      .catch(() => {
        // The silent sign-in check can time out on one slow identity response. One fresh
        // attempt, on a new instance, before reporting the identity service as unavailable.
        const retry = createKeycloak();
        keycloak = retry;
        return initInstance(retry);
      })
      .catch((error) => {
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
