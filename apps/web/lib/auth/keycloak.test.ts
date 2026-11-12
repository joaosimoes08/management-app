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
    delete window.__COCIBER_CONFIG__;
    vi.resetModules();
    adapter.init.mockClear().mockResolvedValue(false);
    adapter.instance = null;
  });

  it('uses the HTTPS deployment URL supplied after the auth module was imported', async () => {
    delete window.__COCIBER_CONFIG__;
    const auth = await import('./keycloak');

    window.__COCIBER_CONFIG__ = {
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
