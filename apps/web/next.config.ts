import type { NextConfig } from 'next';

// Headers that never depend on the deployment. The Content-Security-Policy and HSTS depend on
// runtime origins and the request scheme, so proxy.ts sets those per request.
const commonHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      // Every route except the Keycloak silent check-sso page may never be framed.
      { source: '/((?!silent-check-sso\\.html$).*)', headers: [...commonHeaders, { key: 'X-Frame-Options', value: 'DENY' }] },
      // keycloak-js loads the silent check-sso page in an iframe on the app's own origin.
      { source: '/silent-check-sso.html', headers: [...commonHeaders, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
    ];
  },
};

export default nextConfig;
