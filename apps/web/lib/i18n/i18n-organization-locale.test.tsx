import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, organizationLocaleFrom, useI18n } from './i18n';

const mocks = vi.hoisted(() => ({ auth: { setupStatus: null as unknown }, apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/runtime-config', async (original) => ({ ...await original<typeof import('@/lib/runtime-config')>(), getConfiguredLocale: () => 'pt-PT' }));

function LocaleLog({ log }: { log: string[] }) {
  const { locale } = useI18n();
  log.push(locale);
  return <span data-testid="locale">{locale}</span>;
}

beforeEach(() => { window.localStorage.clear(); mocks.apiFetch.mockReset(); mocks.auth = { setupStatus: null }; });
afterEach(cleanup);

describe('organizationLocaleFrom', () => {
  it('uses the saved organization locale only once setup saved one', () => {
    expect(organizationLocaleFrom({ setupCompleted: true, locale: 'en-US' })).toBe('en-US');
    expect(organizationLocaleFrom({ setupCompleted: false, organizationName: 'Org', locale: 'en-US' })).toBe('en-US');
    expect(organizationLocaleFrom({ setupCompleted: false, organizationName: ' ', locale: 'en-US' })).toBeNull();
    expect(organizationLocaleFrom({ setupCompleted: true, locale: 'fr-FR' })).toBeNull();
    expect(organizationLocaleFrom(null)).toBeNull();
  });
});

describe('I18nProvider organization locale', () => {
  it('applies the locale from the shared setup status on the first render after sign-in, with no extra request', () => {
    const log: string[] = [];
    const { rerender } = render(<I18nProvider><LocaleLog log={log} /></I18nProvider>);
    expect(screen.getByTestId('locale').textContent).toBe('pt-PT');

    log.length = 0;
    mocks.auth = { setupStatus: { setupCompleted: true, organizationName: 'Org', locale: 'en-US' } };
    rerender(<I18nProvider><LocaleLog log={log} /></I18nProvider>);

    expect(log).toEqual(['en-US']);
    expect(screen.getByTestId('locale').textContent).toBe('en-US');
    expect(window.localStorage.getItem('civernode.locale')).toBe('en-US');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('keeps the user locale when setup has not saved an organization locale', () => {
    window.localStorage.setItem('civernode.locale', 'en-US');
    mocks.auth = { setupStatus: { setupCompleted: false, organizationName: null, locale: 'pt-PT' } };
    render(<I18nProvider><LocaleLog log={[]} /></I18nProvider>);
    expect(screen.getByTestId('locale').textContent).toBe('en-US');
    expect(window.localStorage.getItem('civernode.locale')).toBe('en-US');
  });

  it('never replaces the app with a loading screen while the locale resolves', () => {
    mocks.auth = { setupStatus: null };
    render(<I18nProvider><p>app</p></I18nProvider>);
    expect(screen.getByText('app')).toBeInTheDocument();
  });
});
