/**
 * Content-Security-Policy for the web app, built per request by `proxy.ts`.
 *
 * It is built at request time (not in `next.config.ts` `headers()`, which `next start` freezes into
 * the build's routes manifest) because a Docker deployment sets the API and Keycloak origins when
 * the container starts: `docker-entrypoint.sh` writes them into `window.__CIVERNODE_CONFIG__`
 * (public/runtime-config.js) from the same NEXT_PUBLIC_* variables read here.
 */

/** SHA-256 of the inline script in public/silent-check-sso.html (checked by csp.test.ts). */
export const SILENT_CHECK_SSO_SCRIPT_HASH = "'sha256-0zZPgsifJ8h8aM+gmSxkrfNtAGUZb7ItVug6/j1UR5g='";

/** The Keycloak silent check-sso page is framed by the app itself, so it may not deny all framing. */
export const SILENT_CHECK_SSO_PATH = '/silent-check-sso.html';

export interface CspOptions {
  nonce: string;
  /** NEXT_PUBLIC_API_URL; empty means the API is same-origin (nginx /api/) or the localhost fallback. */
  apiUrl?: string;
  /** NEXT_PUBLIC_KEYCLOAK_URL; defaults to http://localhost:8080 as in lib/runtime-config.ts. */
  keycloakUrl?: string;
  /** Host name of the request, to mirror the localhost API fallback in lib/runtime-config.ts. */
  requestHostname: string;
  /** Development server: React and the HMR runtime need eval and a websocket. */
  dev: boolean;
  /** Request path: the silent check-sso page is allowed to be framed by the app. */
  pathname?: string;
}

const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'];

export function toOrigin(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Origins the browser calls with fetch: the API and Keycloak (token refresh, account, logout). */
export function connectOrigins({ apiUrl, keycloakUrl, requestHostname }: Pick<CspOptions, 'apiUrl' | 'keycloakUrl' | 'requestHostname'>): string[] {
  const api = toOrigin(apiUrl) ?? (LOCAL_HOSTNAMES.includes(requestHostname) ? 'http://localhost:3001' : null);
  const keycloak = toOrigin(keycloakUrl || 'http://localhost:8080');
  return [...new Set([api, keycloak].filter((origin): origin is string => Boolean(origin)))];
}

export function buildCsp(options: CspOptions): string {
  const origins = connectOrigins(options);
  const keycloak = toOrigin(options.keycloakUrl || 'http://localhost:8080');
  const api = origins.filter((origin) => origin !== keycloak);
  const framedBySelf = options.pathname === SILENT_CHECK_SSO_PATH;
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Next.js puts the nonce on its own inline and chunk scripts; the hash covers the static
    // silent check-sso page. Development only: React and the HMR client evaluate code with eval.
    'script-src': ["'self'", `'nonce-${options.nonce}'`, SILENT_CHECK_SSO_SCRIPT_HASH, ...(options.dev ? ["'unsafe-eval'"] : [])],
    // React `style` props (xyflow positions every node with them) and the theme <style> tag are
    // inline styles; nonces cannot cover style attributes, so styles keep 'unsafe-inline'.
    // app/globals.css imports the DM Sans / DM Mono stylesheet from Google Fonts.
    'style-src': ["'self'", "'unsafe-inline'", GOOGLE_FONTS_CSS],
    // Asset images come from the API directly or as blob: URLs fetched with the bearer token.
    'img-src': ["'self'", 'data:', 'blob:', ...api],
    'font-src': ["'self'", 'data:', GOOGLE_FONTS_FILES],
    'connect-src': ["'self'", ...origins, ...(options.dev ? ['ws:', 'wss:'] : [])],
    // keycloak-js frames Keycloak for the silent sign-in check, which redirects back to this app.
    'frame-src': ["'self'", ...(keycloak ? [keycloak] : [])],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': [framedBySelf ? "'self'" : "'none'"],
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}
