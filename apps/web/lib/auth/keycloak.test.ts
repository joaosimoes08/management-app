import { afterEach, describe, expect, it, vi } from 'vitest';

const adapter = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(false),
  instance: null as { init: ReturnType<typeof vi.fn> } | null,
}));

vi.mock('keycloak-js', () => ({
  default: class MockKeycloak {
    init = adapter.init;
    constructor(config: unknown) {
      adapter.instance = this;
      Object.assign(this, { config });
    }
  },
}));

describe('Keycloak runtime configuration', () => {
  afterEach(() => {
    delete window.__CIVERNODE_CONFIG__;
    vi.resetModules();
    adapter.init.mockClear().mockResolvedValue(false);
    adapter.instance = null;
  });

  it('uses the HTTPS deployment URL supplied after the auth module was imported', async () => {
    delete window.__CIVERNODE_CONFIG__;
    const auth = await import('./keycloak');

    window.__CIVERNODE_CONFIG__ = {
      keycloakUrl: 'https://sso.example.test',
      keycloakRealm: 'production',
      keycloakClientId: 'web-client',
    };

    await expect(auth.initializeKeycloak()).resolves.toBe(false);

    expect(adapter.instance).toMatchObject({
      config: {
        url: 'https://sso.example.test',
        realm: 'production',
        clientId: 'web-client',
      },
    });
    expect(adapter.init).toHaveBeenCalledWith(expect.objectContaining({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    }));
  });
});

describe('Keycloak third-party cookie probe', () => {
  afterEach(() => {
    delete window.__CIVERNODE_CONFIG__;
    vi.resetModules();
    adapter.instance = null;
  });

  it('drops only the third-party cookie probe endpoint when Keycloak is on the page host', async () => {
    window.__CIVERNODE_CONFIG__ = { keycloakUrl: `http://${window.location.hostname}:4080`, keycloakRealm: 'r', keycloakClientId: 'c' };
    const auth = await import('./keycloak');
    await auth.initializeKeycloak();
    const instance = adapter.instance as unknown as { endpoints?: Record<string, unknown> };
    instance.endpoints = { authorize: () => 'a', thirdPartyCookiesIframe: () => 'p' };
    expect(Object.keys(instance.endpoints ?? {})).toEqual(['authorize']);
  });

  it('leaves the adapter alone when Keycloak is on another host', async () => {
    window.__CIVERNODE_CONFIG__ = { keycloakUrl: 'https://sso.example.test', keycloakRealm: 'r', keycloakClientId: 'c' };
    const auth = await import('./keycloak');
    await auth.initializeKeycloak();
    const instance = adapter.instance as unknown as { endpoints?: Record<string, unknown> };
    instance.endpoints = { authorize: () => 'a', thirdPartyCookiesIframe: () => 'p' };
    expect(Object.keys(instance.endpoints ?? {})).toEqual(['authorize', 'thirdPartyCookiesIframe']);
  });
});
