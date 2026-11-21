import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuditPage from './audit-page';
import type { AuditPageEvent } from './api';

vi.mock('@/components/layout/app-shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/app-shell')>(),
  AppShell: ({ children, actions, search }: { children: React.ReactNode; actions?: React.ReactNode; search?: { value: string; onChange: (value: string) => void; placeholder: string } }) => <>
    <div data-testid="toolbar-actions">{actions}</div>
    {search && <input aria-label="Pesquisa da página" placeholder={search.placeholder} value={search.value} onChange={(event) => search.onChange(event.target.value)} />}
    {children}
  </>,
}));
const client = vi.hoisted(() => ({ apiFetch: vi.fn(), apiDownload: vi.fn() }));
vi.mock('@/lib/api/client', () => client);

const event = (id: string, extra: Partial<AuditPageEvent> = {}): AuditPageEvent => ({
  id, action: 'DEVICE_UPDATED', entityType: 'Device', entityId: `dev-${id}`, createdAt: '2026-11-20T10:00:00.000Z',
  ipAddress: '10.0.0.9', userId: 'u1', user: { id: 'u1', username: 'ana', displayName: 'Ana' }, metadata: { siteId: 's1', name: `SW-${id}` }, diff: null, hasDiff: false, ...extra,
});
const facets = { actions: [{ value: 'DEVICE_UPDATED', count: 3 }], entityTypes: [{ value: 'Device', count: 3 }], actors: [{ id: 'u1', username: 'ana', displayName: 'Ana', count: 3 }], truncated: false };

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuditPage /></QueryClientProvider>);
const urls = () => client.apiFetch.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  window.history.replaceState(null, '', '/auditoria');
  client.apiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/audit/facets')) return facets;
    if (url.includes('cursor=c2')) return { items: [event('3')], nextCursor: null, hasMore: false, limit: 50 };
    return { items: [event('1'), event('2', { action: 'RETENTION_UPDATED', entityType: 'SystemSettings', entityId: 'retention', diff: [{ field: 'days', before: 90, after: 30 }], hasDiff: true, metadata: { previousDays: 90, nextDays: 30 } })], nextCursor: 'c2', hasMore: true, limit: 50 };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AuditPage', () => {
  it('loads the first page without HTTP noise and appends the next page with the cursor', async () => {
    renderPage();
    expect(await screen.findByText('2 eventos carregados')).toBeInTheDocument();
    expect(urls().find((url) => url.startsWith('/api/v1/audit/events/page'))).toContain('excludeHttp=true');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('3 eventos')).toBeInTheDocument();
    expect(urls().some((url) => url.includes('cursor=c2'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('lands filtered from ?q= links and sends the dropdown filters to the server', async () => {
    window.history.replaceState(null, '', '/auditoria?q=dev-1&actor=u1');
    renderPage();
    await screen.findByText('2 eventos carregados');
    const pageUrl = urls().find((url) => url.startsWith('/api/v1/audit/events/page'))!;
    expect(pageUrl).toContain('q=dev-1');
    expect(pageUrl).toContain('actorId=u1');
    expect(await screen.findByRole('option', { name: 'Ana (3)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar por ação'), { target: { value: 'DEVICE_UPDATED' } });
    expect(window.location.search).toContain('action=DEVICE_UPDATED');
    await waitFor(() => expect(urls().some((url) => url.includes('action=DEVICE_UPDATED'))).toBe(true));
  });

  it('links the changed record and shows a plain state when no before/after was stored', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'SW-1' });
    expect(link).toHaveAttribute('href', '/infraestrutura?siteId=s1&tab=devices&deviceId=dev-1&focus=device');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalhe de DEVICE_UPDATED' })[0]);
    const panel = screen.getByRole('complementary', { name: 'Detalhe de DEVICE_UPDATED' });
    expect(within(panel).getByText(/não guardou os valores anteriores/)).toBeInTheDocument();
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Histórico deste registo' })).toHaveAttribute('href', '/auditoria?q=dev-1');
    expect(window.location.search).toContain('event=1');
  });

  it('shows the stored before → after values', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalhe de RETENTION_UPDATED' }));
    const panel = screen.getByRole('complementary', { name: 'Detalhe de RETENTION_UPDATED' });
    const row = within(panel).getByRole('row', { name: /days/ });
    expect(row).toHaveTextContent('90');
    expect(row).toHaveTextContent('30');
    expect(within(panel).queryByText('previousDays')).not.toBeInTheDocument();
  });

  it('exports the server CSV with the same filters and reports the row count', async () => {
    window.history.replaceState(null, '', '/auditoria?entityType=Device');
    client.apiDownload.mockResolvedValue(new Headers({ 'X-Export-Row-Count': '2', 'X-Export-Truncated': 'false' }));
    renderPage();
    await screen.findByText('2 eventos carregados');
    fireEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }));
    expect(await screen.findByText('CSV exportado com 2 eventos.')).toBeInTheDocument();
    const [path, fileName] = client.apiDownload.mock.calls[0];
    expect(path).toMatch(/^\/api\/v1\/audit\/events\/export\?/);
    expect(path).toContain('entityType=Device');
    expect(path).toContain('excludeHttp=true');
    expect(path).not.toContain('cursor');
    expect(fileName).toMatch(/^auditoria-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
