import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCsp, connectOrigins, SILENT_CHECK_SSO_SCRIPT_HASH } from './csp';

const directive = (csp: string, name: string) => csp.split('; ').find((part) => part.startsWith(`${name} `));
const base = { nonce: 'abc123', requestHostname: 'localhost', dev: false };

describe('buildCsp', () => {
  it('locks down scripts, objects, base URI and framing in production', () => {
    const csp = buildCsp(base);
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(directive(csp, 'script-src')).toBe(`script-src 'self' 'nonce-abc123' ${SILENT_CHECK_SSO_SCRIPT_HASH}`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('allows eval and the HMR websocket only on the development server', () => {
    const csp = buildCsp({ ...base, dev: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('ws:');
  });

  it('scopes connect-src to the configured API and Keycloak origins', () => {
    const csp = buildCsp({ ...base, requestHostname: 'mgmt.example.pt', apiUrl: 'https://api.example.pt/v1', keycloakUrl: 'https://sso.example.pt/' });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://api.example.pt https://sso.example.pt");
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self' https://sso.example.pt");
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob: https://api.example.pt");
  });

  it('mirrors the runtime-config API fallback: localhost:3001 only when the page is on localhost', () => {
    expect(connectOrigins({ requestHostname: 'localhost' })).toEqual(['http://localhost:3001', 'http://localhost:8080']);
    expect(connectOrigins({ requestHostname: 'mgmt.example.pt', keycloakUrl: 'https://mgmt.example.pt' })).toEqual(['https://mgmt.example.pt']);
  });

  it('allows the Google Fonts stylesheet and font files imported by globals.css', () => {
    const csp = buildCsp(base);
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(directive(csp, 'font-src')).toBe("font-src 'self' data: https://fonts.gstatic.com");
  });

  it('ignores URLs that are not http(s)', () => {
    expect(connectOrigins({ requestHostname: 'x.pt', apiUrl: 'javascript:alert(1)', keycloakUrl: 'not a url' })).toEqual([]);
  });

  it('lets the app frame only the silent check-sso page', () => {
    expect(directive(buildCsp({ ...base, pathname: '/silent-check-sso.html' }), 'frame-ancestors')).toBe("frame-ancestors 'self'");
    expect(directive(buildCsp({ ...base, pathname: '/topology' }), 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('pins the hash of the inline script in public/silent-check-sso.html', () => {
    const html = readFileSync(path.resolve(import.meta.dirname, '../../public/silent-check-sso.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(scripts).toHaveLength(1);
    expect(SILENT_CHECK_SSO_SCRIPT_HASH).toBe(`'sha256-${createHash('sha256').update(scripts[0]).digest('base64')}'`);
  });
});
