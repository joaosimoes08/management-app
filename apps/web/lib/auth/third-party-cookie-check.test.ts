import Keycloak from 'keycloak-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSameHostIdentity, skipThirdPartyCookieCheckOnSameHost } from './third-party-cookie-check';

type AppendSpy = { mock: { calls: unknown[][] } };
function firstIframeSrc(appendChild: AppendSpy): string | undefined {
  const node = appendChild.mock.calls.map((call) => call[0]).find((child) => child instanceof HTMLIFrameElement) as HTMLIFrameElement | undefined;
  return node?.getAttribute('src') ?? undefined;
}

async function startCheckSso(keycloakUrl: string, apply: boolean) {
  const appendChild = vi.spyOn(document.body, 'appendChild');
  const instance = new Keycloak({ url: keycloakUrl, realm: 'r', clientId: 'c' });
  if (apply) skipThirdPartyCookieCheckOnSameHost(instance, keycloakUrl, window.location.href);
  // The init never settles here (no identity server answers the iframes); we only need the first frame.
  void instance.init({ onLoad: 'check-sso', silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`, checkLoginIframe: false, pkceMethod: 'S256' }).catch(() => undefined);
  await vi.waitFor(() => expect(firstIframeSrc(appendChild)).toBeDefined());
  return { instance, src: firstIframeSrc(appendChild)! };
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('isSameHostIdentity', () => {
  it('compares host names and ignores port and scheme', () => {
    expect(isSameHostIdentity('http://localhost:4080', 'http://localhost:4000/ipam')).toBe(true);
    expect(isSameHostIdentity('https://app.example.test/auth', 'https://app.example.test/')).toBe(true);
    expect(isSameHostIdentity('https://sso.example.test', 'https://app.example.test/')).toBe(false);
  });

  it('treats an unparsable URL as a different host', () => {
    expect(isSameHostIdentity('not a url', 'http://localhost/')).toBe(false);
  });
});

describe('skipThirdPartyCookieCheckOnSameHost with the real keycloak-js adapter', () => {
  it('goes straight to the silent check-sso frame when Keycloak is on the page host', async () => {
    const { instance, src } = await startCheckSso('http://localhost:4080', true);
    expect(src).toContain('/realms/r/protocol/openid-connect/auth');
    expect(src).toContain('prompt=none');
    expect(src).toContain('code_challenge_method=S256');
    // Every other endpoint is still there.
    const endpoints = (instance as unknown as { endpoints: Record<string, unknown> }).endpoints;
    expect(endpoints.thirdPartyCookiesIframe).toBeUndefined();
    expect(typeof endpoints.authorize).toBe('function');
    expect(typeof endpoints.token).toBe('function');
    expect(typeof endpoints.logout).toBe('function');
  });

  it('keeps the third-party cookie probe when Keycloak is on another host', async () => {
    const { src } = await startCheckSso('https://sso.example.test', true);
    expect(src).toContain('/protocol/openid-connect/3p-cookies/step1.html');
  });

  it('matches the unmodified adapter when not applied (control)', async () => {
    const { src } = await startCheckSso('http://localhost:4080', false);
    expect(src).toContain('/protocol/openid-connect/3p-cookies/step1.html');
  });
});
