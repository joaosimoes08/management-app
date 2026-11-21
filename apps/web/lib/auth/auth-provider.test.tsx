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
vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: 'http://api.test' }) }));

function Probe() {
  const auth = useContext(AuthContext)!;
  return <pre data-testid="auth">{JSON.stringify({ loading: auth.loading, authenticated: auth.authenticated, user: auth.user?.username ?? null, profile: auth.profile?.username ?? null, setupStatus: auth.setupStatus, setupStatusError: auth.setupStatusError })}</pre>;
}
const state = () => JSON.parse(screen.getByTestId('auth').textContent ?? '{}') as Record<string, unknown>;

const fetchMock = vi.fn();
beforeEach(() => {
  mocks.initializeKeycloak.mockReset().mockResolvedValue(true);
  mocks.instance.loadUserProfile.mockReset().mockResolvedValue({ username: 'kc-user' });
  mocks.apiFetch.mockReset().mockResolvedValue({ setupCompleted: true, organizationName: 'Org', locale: 'en-US' });
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ username: 'api-user', roles: ['ADMIN'] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuthProvider sign-in', () => {
  it('starts profile, identity and setup status together, before any of them answers', async () => {
    const profile = deferred<{ username: string }>(); const identity = deferred<Response>(); const setup = deferred<unknown>();
    mocks.instance.loadUserProfile.mockReturnValue(profile.promise);
    fetchMock.mockReturnValue(identity.promise);
    mocks.apiFetch.mockReturnValue(setup.promise);
    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => {
      expect(mocks.instance.loadUserProfile).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/setup/status');
    });
    // Same token verification as before: /auth/me with the Keycloak bearer token.
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/v1/auth/me', expect.objectContaining({ headers: { Authorization: 'Bearer access-token' } }));
    expect(state().loading).toBe(true);

    setup.resolve({ setupCompleted: true, organizationName: 'Org', locale: 'pt-PT' });
    identity.resolve(new Response(JSON.stringify({ username: 'api-user', roles: [] }), { status: 200 }));
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
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(state()).toMatchObject({ loading: false, authenticated: false, user: null, setupStatus: null }));
  });

  it('reports a setup status failure without dropping the session', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('setup down'));
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
