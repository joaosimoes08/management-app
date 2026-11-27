import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AuthGate } from './auth-gate';

const signedOut = { loading: false, authError: null, authenticated: false, setupStatus: null, setupStatusError: null };
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), auth: {} as Record<string, unknown>, uiLocale: null as string | null }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ login: vi.fn(), retry: vi.fn(), ...mocks.auth }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string) => key }) }));
// useUiText reads the active language from '@/lib/i18n/i18n'; without a provider it falls back to pt-PT.
vi.mock('@/lib/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n/i18n')>();
  return { ...actual, useOptionalI18n: () => (mocks.uiLocale ? { t: (key: string, fallback?: string, params?: Record<string, string | number>) => actual.translateMessage(mocks.uiLocale as 'en-US', key, fallback, params) } : null) };
});
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/runtime-config', () => ({ getPublicOrganizationName: () => 'Org', getPublicRuntimeConfig: () => ({ apiUrl: '', keycloakRealm: 'r' }) }));

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); mocks.apiFetch.mockReset(); mocks.uiLocale = null; vi.restoreAllMocks(); });
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

  it('shows the Civernode mark and the swappable scene image on the signed-out page', () => {
    const { container } = render(<AuthGate><p>app</p></AuthGate>);
    const sources = Array.from(container.querySelectorAll('img')).map((image) => image.getAttribute('src'));
    expect(sources).toContain('/brand/civernode-mark.png');
    expect(sources).toContain('/brand/auth-scene.png');
    expect(container.querySelectorAll('img[alt=""]')).toHaveLength(2);
    expect(screen.getByText('ORG')).toBeInTheDocument();
    expect(screen.queryByText('SECURE INFRASTRUCTURE')).toBeNull();
  });

  it('shows the translated tagline in Portuguese by default and in English when the UI is English', () => {
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('Gestão de infraestrutura')).toBeInTheDocument();
    cleanup();
    mocks.uiLocale = 'en-US';
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByText('Infrastructure management')).toBeInTheDocument();
    expect(screen.queryByText('Gestão de infraestrutura')).toBeNull();
  });

  it('keeps no hard-coded tagline text in the component', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'auth-gate.tsx'), 'utf8');
    expect(source).not.toMatch(/Infrastructure/);
    expect(source).toContain("ui('authGate.tagline')");
  });

  it('no longer decides anything from the URL: public pages live outside every AuthGate', () => {
    window.history.replaceState(null, '', '/relatorios/cancelar-subscricao?token=tok123');
    render(<AuthGate><p>app</p></AuthGate>);
    expect(screen.getByRole('button', { name: /Continuar com Keycloak/ })).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
    const source = readFileSync(path.join(import.meta.dirname, 'auth-gate.tsx'), 'utf8');
    expect(source).not.toContain('window.location.pathname');
  });

  it('lets /setup render while setup is incomplete, and does not redirect it to itself', () => {
    const replace = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/setup', replace } as Location);
    mocks.auth = { ...signedOut, authenticated: true, setupStatus: { setupCompleted: false } };
    render(<AuthGate requireCompletedSetup={false}><p>setup wizard</p></AuthGate>);
    expect(screen.getByText('setup wizard')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('still asks for sign-in on /setup', () => {
    render(<AuthGate requireCompletedSetup={false}><p>setup wizard</p></AuthGate>);
    expect(screen.getByRole('button', { name: /Continuar com Keycloak/ })).toBeInTheDocument();
    expect(screen.queryByText('setup wizard')).toBeNull();
  });

  it('shows /setup instead of the setup-status error screen', () => {
    mocks.auth = { ...signedOut, authenticated: true, setupStatusError: 'setup down' };
    render(<AuthGate requireCompletedSetup={false}><p>setup wizard</p></AuthGate>);
    expect(screen.getByText('setup wizard')).toBeInTheDocument();
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
