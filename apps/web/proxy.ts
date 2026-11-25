import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from '@/lib/security/csp';

/**
 * Next.js proxy (the Next 16 name for middleware). Per-request security headers that depend on the
 * deployment: the Content-Security-Policy (fresh script nonce, API and Keycloak origins from the
 * container's environment) and HSTS (only over TLS).
 * Constant headers live in next.config.ts.
 */

// Read by key so the build does not inline NEXT_PUBLIC_* values: a Docker image is built once and
// started with its own origins (see docker-entrypoint.sh).
const runtimeEnv = (name: string): string | undefined => process.env[name];

const HSTS = 'max-age=31536000; includeSubDomains';

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    apiUrl: runtimeEnv('NEXT_PUBLIC_API_URL'),
    keycloakUrl: runtimeEnv('NEXT_PUBLIC_KEYCLOAK_URL'),
    requestHostname: request.nextUrl.hostname,
    dev: process.env.NODE_ENV === 'development',
    pathname: request.nextUrl.pathname,
  });

  // Next.js reads the nonce from the request's CSP header and puts it on the scripts it renders.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  // TLS terminates at nginx (nginx/https.conf sends X-Forwarded-Proto: https). Browsers ignore HSTS
  // over plain http anyway; HSTS_DISABLED=true turns it off for a TLS deployment that must not pin.
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const overTls = forwardedProto === 'https' || request.nextUrl.protocol === 'https:';
  if (overTls && runtimeEnv('HSTS_DISABLED') !== 'true') response.headers.set('Strict-Transport-Security', HSTS);
  return response;
}

export const config = {
  // Static chunks and the image optimiser carry no documents; everything else gets the headers.
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
