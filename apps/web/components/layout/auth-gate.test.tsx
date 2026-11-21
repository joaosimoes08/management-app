import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './auth-gate';

const signedOut = { loading: false, authError: null, authenticated: false, setupStatus: null, setupStatusError: null };
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ login: vi.fn(), retry: vi.fn(), ...mocks.auth }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string) => key }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/runtime-config', () => ({ getPublicOrganizationName: () => 'Org', getPublicRuntimeConfig: () => ({ apiUrl: '', keycloakRealm: 'r' }) }));
vi.mock('@/features/reports/report-unsubscribe', () => ({
  PUBLIC_UNSUBSCRIBE_PATH: '/relatorios/cancelar-subscricao',
  ReportUnsubscribe: ({ token }: { token: string | null }) => <p>unsubscribe:{token}</p>,
}));

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); mocks.apiFetch.mockReset(); vi.restoreAllMocks(); });
beforeEach(() => { mocks.auth = { ...signedOut }; });

function CountMounts({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return <p>app</p>;
}

describe('AuthGate', () => {
  it('asks for sign-in on app pages', () => {
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByRole('button', { name: /Continuar com Keycloak/ })).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('shows the email unsubscribe page without a session and without the app', () => {
    window.history.replaceState(null, '', '/relatorios/cancelar-subscricao?token=tok123');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('unsubscribe:tok123')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
    expect(screen.queryByRole('button', { name: /Keycloak/ })).toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('mounts the app once when the shared setup status says setup is complete, without its own request', () => {
    mocks.auth = { ...signedOut, authenticated: true, setupStatus: { setupCompleted: true, organizationName: 'Org', locale: 'pt-PT' } };
    const onMount = vi.fn();
    const { rerender } = render(<AuthGate><CountMounts onMount={onMount} /></AuthGate>);
    rerender(<AuthGate><CountMounts onMount={onMount} /></AuthGate>);
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('keeps the app hidden and sends the user to setup when setup is not complete', () => {
    const replace = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/', replace } as Location);
    mocks.auth = { ...signedOut, authenticated: true, setupStatus: { setupCompleted: false } };
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('A validar a configuração inicial...')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/setup');
  });

  it('shows the setup error from sign-in instead of the app', () => {
    mocks.auth = { ...signedOut, authenticated: true, setupStatusError: 'setup down' };
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('Não foi possível validar o setup.')).toBeInTheDocument();
    expect(screen.getByText('setup down')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('still waits for sign-in to finish before showing anything', () => {
    mocks.auth = { ...signedOut, loading: true };
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('A ligar a Org...')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
  });
});
