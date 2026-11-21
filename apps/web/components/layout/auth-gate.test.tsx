import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './auth-gate';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ loading: false, authError: null, authenticated: false, login: vi.fn(), retry: vi.fn() }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string) => key }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/runtime-config', () => ({ getPublicOrganizationName: () => 'Org', getPublicRuntimeConfig: () => ({ apiUrl: '', keycloakRealm: 'r' }) }));
vi.mock('@/features/reports/report-unsubscribe', () => ({
  PUBLIC_UNSUBSCRIBE_PATH: '/relatorios/cancelar-subscricao',
  ReportUnsubscribe: ({ token }: { token: string | null }) => <p>unsubscribe:{token}</p>,
}));

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

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
});
