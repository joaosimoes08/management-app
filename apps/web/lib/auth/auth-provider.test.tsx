import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, AuthProvider } from './auth-provider';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  instance: {
    token: 'access-token', authenticated: true,
    loadUserProfile: vi.fn(), updateToken: vi.fn(), login: vi.fn(), logout: vi.fn(),
    onTokenExpired: undefined as unknown, onAuthLogout: undefined as unknown,
  },
  apiFetch: vi.fn(),
  initializeKeycloak: vi.fn(),
}));

vi.mock('./keycloak', () => ({ initializeKeycloak: mocks.initializeKeycloak, getKeycloakInstance: () => mocks.instance }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch, setApiTokenProvider: vi.fn(), setApiUnauthorizedHandler: vi.fn() }));

function Probe() {
  const auth = useContext(AuthContext)!;
  return <pre data-testid="auth">{JSON.stringify({ loading: auth.loading, authenticated: auth.authenticated, user: auth.user?.username ?? null, profile: auth.profile?.username ?? null, setupStatus: auth.setupStatus, setupStatusError: auth.setupStatusError })}</pre>;
}
const state = () => JSON.parse(screen.getByTestId('auth').textContent ?? '{}') as Record<string, unknown>;

const apiUser = (username: string, roles: string[] = []) => ({ id: `id-${username}`, externalId: `kc-${username}`, username, roles });
// The provider reaches the API only through the client: /auth/me and /setup/status are told apart by path.
const identity = vi.fn();
const setup = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  mocks.initializeKeycloak.mockReset().mockResolvedValue(true);
  mocks.instance.loadUserProfile.mockReset().mockResolvedValue({ username: 'kc-user' });
  identity.mockReset().mockResolvedValue(apiUser('api-user', ['ADMIN']));
  setup.mockReset().mockResolvedValue({ setupCompleted: true, organizationName: 'Org', locale: 'en-US' });
  mocks.apiFetch.mockReset().mockImplementation((path: string, init?: unknown) => (path === '/api/v1/auth/me' ? identity(init) : setup(init)));
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuthProvider sign-in', () => {
  it('starts profile, identity and setup status together, before any of them answers', async () => {
    const profile = deferred<{ username: string }>(); const identityAnswer = deferred<unknown>(); const setupAnswer = deferred<unknown>();
    mocks.instance.loadUserProfile.mockReturnValue(profile.promise);
    identity.mockReturnValue(identityAnswer.promise);
    setup.mockReturnValue(setupAnswer.promise);
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(mocks.instance.loadUserProfile).toHaveBeenCalledTimes(1);
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({ cache: 'no-store', redirectOnUnauthorized: false }));
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/setup/status');
    });
    // The identity goes through the API client (which adds the token): no raw fetch from the provider.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state().loading).toBe(true);

    setupAnswer.resolve({ setupCompleted: true, organizationName: 'Org', locale: 'pt-PT' });
    identityAnswer.resolve(apiUser('api-user'));
    expect(state().loading).toBe(true);
    profile.resolve({ username: 'kc-user' });

    await waitFor(() => expect(state()).toEqual({ loading: false, authenticated: true, user: 'api-user', profile: 'kc-user', setupStatus: { setupCompleted: true, organizationName: 'Org', locale: 'pt-PT' }, setupStatusError: null }));
  });

  it('keeps a valid session when only the Keycloak profile fails', async () => {
    mocks.instance.loadUserProfile.mockRejectedValue(new Error('CORS'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state()).toMatchObject({ loading: false, authenticated: true, user: 'api-user', profile: null }));
  });

  it('signs out of the app when the API rejects the identity, whatever the setup status said', async () => {
    identity.mockRejectedValue(Object.assign(new Error('Session expired'), { status: 401 }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state()).toMatchObject({ loading: false, authenticated: false, user: null, setupStatus: null }));
  });

  it('signs out of the app when /auth/me answers a body that is not an ApiUser', async () => {
    identity.mockResolvedValue({ username: 'api-user' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state()).toMatchObject({ loading: false, authenticated: false, user: null }));
  });

  it('exposes neither an access token nor the Keycloak adapter on the context', async () => {
    function Keys() { return <pre data-testid="keys">{Object.keys(useContext(AuthContext)!).join(',')}</pre>; }
    render(<AuthProvider><Keys /></AuthProvider>);
    const keys = () => (screen.getByTestId('keys').textContent ?? '').split(',');
    await waitFor(() => expect(keys()).toContain('user'));
    expect(keys()).not.toContain('token');
    expect(keys()).not.toContain('keycloak');
  });

  it('reports a setup status failure without dropping the session', async () => {
    setup.mockRejectedValue(new Error('setup down'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state()).toMatchObject({ loading: false, authenticated: true, user: 'api-user', setupStatus: null, setupStatusError: 'setup down' }));
  });

  it('makes no API calls without a Keycloak session', async () => {
    mocks.initializeKeycloak.mockResolvedValue(false);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state()).toMatchObject({ loading: false, authenticated: false }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.instance.loadUserProfile).not.toHaveBeenCalled();
  });
});
