import type Keycloak from 'keycloak-js';

/**
 * True when the identity server runs on the same host name as the web app (any port or scheme).
 * Cookies are scoped by host, not port, so Keycloak's session cookie is then a first-party
 * cookie for this page and the browser can never block it as a third-party cookie.
 */
export function isSameHostIdentity(keycloakUrl: string, pageUrl: string): boolean {
  try {
    return new URL(keycloakUrl).hostname === new URL(pageUrl).hostname;
  } catch {
    return false;
  }
}

type Endpoints = Record<string, unknown> & { thirdPartyCookiesIframe?: unknown };

/**
 * keycloak-js loads a hidden `3p-cookies/step1.html` iframe on every page load before the silent
 * sign-in check, only to learn whether the browser blocks third-party cookies. When Keycloak is on
 * the page's own host the answer is always "supported", so the round trip only delays sign-in.
 *
 * The adapter skips the probe when its endpoint table has no `thirdPartyCookiesIframe` entry, so we
 * drop just that entry as the adapter stores the table. Token handling, PKCE, the silent check-sso
 * iframe and every other endpoint are untouched. On a different host nothing changes.
 */
export function skipThirdPartyCookieCheckOnSameHost(instance: Keycloak, keycloakUrl: string, pageUrl: string): void {
  if (!isSameHostIdentity(keycloakUrl, pageUrl)) return;
  let endpoints: Endpoints | undefined = (instance as unknown as { endpoints?: Endpoints }).endpoints;
  Object.defineProperty(instance, 'endpoints', {
    configurable: true,
    enumerable: true,
    get: () => endpoints,
    set: (value: Endpoints | undefined) => {
      if (value && typeof value === 'object') {
        const rest: Endpoints = { ...value };
        delete rest.thirdPartyCookiesIframe;
        endpoints = rest;
      } else {
        endpoints = value;
      }
    },
  });
}
