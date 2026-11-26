import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/i18n';
import { LocaleDocumentTitle } from './locale-document-title';

const mocks = vi.hoisted(() => ({ auth: { setupStatus: null as unknown } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/runtime-config', async (original) => ({ ...await original<typeof import('@/lib/runtime-config')>(), getConfiguredLocale: () => 'pt-PT' }));

beforeEach(() => { window.localStorage.clear(); mocks.auth = { setupStatus: null }; });
afterEach(cleanup);

describe('LocaleDocumentTitle', () => {
  it('uses the Portuguese title in pt-PT', async () => {
    render(<I18nProvider><LocaleDocumentTitle /></I18nProvider>);
    await waitFor(() => expect(document.title).toBe('Civernode · Gestão de Infraestrutura'));
  });

  it('follows the organization locale to English and back', async () => {
    const { rerender } = render(<I18nProvider><LocaleDocumentTitle /></I18nProvider>);
    mocks.auth = { setupStatus: { setupCompleted: true, organizationName: 'Org', locale: 'en-US' } };
    rerender(<I18nProvider><LocaleDocumentTitle /></I18nProvider>);
    await waitFor(() => expect(document.title).toBe('Civernode · Infrastructure Management'));
    mocks.auth = { setupStatus: { setupCompleted: true, organizationName: 'Org', locale: 'pt-PT' } };
    rerender(<I18nProvider><LocaleDocumentTitle /></I18nProvider>);
    await waitFor(() => expect(document.title).toBe('Civernode · Gestão de Infraestrutura'));
  });

  it('is not overridden by a static Next.js metadata title', () => {
    const layout = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/layout.tsx'), 'utf8');
    const metadata = layout.slice(layout.indexOf('export const metadata'), layout.indexOf('};', layout.indexOf('export const metadata')));
    expect(metadata).not.toMatch(/\btitle\s*:/);
    expect(layout).toContain('<LocaleDocumentTitle />');
  });
});
