import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

function wrap(name: string) {
  function Provider({ children }: { children: React.ReactNode }) { return <div data-provider={name}>{children}</div>; }
  return Provider;
}
vi.mock('next/script', () => ({ default: () => null }));
vi.mock('./globals.css', () => ({}));
vi.mock('@/lib/auth', () => ({ AuthProvider: wrap('auth') }));
vi.mock('@/components/layout/auth-gate', () => ({ AuthGate: wrap('gate') }));
vi.mock('@/components/ui/toast', () => ({ ToastProvider: wrap('toast') }));
vi.mock('@/lib/i18n', () => ({ I18nProvider: wrap('i18n') }));
vi.mock('@/lib/query/query-provider', () => ({ QueryProvider: wrap('query') }));
vi.mock('@/lib/site-context', () => ({ SiteProvider: wrap('site') }));

describe('RootLayout provider order', () => {
  it('starts the site list and keeps the query cache above the auth gate', async () => {
    const { default: RootLayout } = await import('./layout');
    const html = renderToStaticMarkup(<RootLayout><p>page</p></RootLayout>);
    const order = [...html.matchAll(/data-provider="([a-z0-9]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(['auth', 'i18n', 'toast', 'query', 'site', 'gate']);
    expect(html).toContain('<div data-provider="gate"><p>page</p></div>');
  });
});
