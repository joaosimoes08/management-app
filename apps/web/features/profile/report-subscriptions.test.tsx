import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportSubscriptions } from './report-subscriptions';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), apiDownload: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch, apiDownload: mocks.apiDownload }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, fallback?: string, params?: Record<string, string>) => params?.name ? `${key}:${params.name}` : fallback ?? key }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = { reportId: 'r-1', name: 'Operação semanal', enabled: true, frequency: 'WEEKLY', dayOfWeek: 1, dayOfMonth: null, hour: 8, timezone: 'Europe/Lisbon', sendEmail: true, subscribed: true };
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReportSubscriptions userId="u-1" /></QueryClientProvider>);

describe('ReportSubscriptions', () => {
  it('renders nothing when the person receives no reports', async () => {
    mocks.apiFetch.mockResolvedValue({ items: [] });
    const { container } = mount();
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/reports/subscriptions'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('toggles the subscription and downloads the CSV on demand', async () => {
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => init?.method === 'PATCH' ? { reportId: 'r-1', subscribed: JSON.parse(String(init.body)).subscribed } : { items: [item] });
    mount();
    const box = await screen.findByRole('checkbox', { name: /Operação semanal/ });
    expect(box).toBeChecked();
    expect(screen.getByText('Semanal · segunda-feira às 08:00 (Europe/Lisbon)')).toBeInTheDocument();
    fireEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/reports/subscriptions/r-1', { method: 'PATCH', body: '{"subscribed":false}' });
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/reports/subscriptions/r-1', { method: 'PATCH', body: '{"subscribed":true}' });

    fireEvent.click(screen.getByRole('button', { name: 'reports.downloadLabel:Operação semanal' }));
    await waitFor(() => expect(mocks.apiDownload).toHaveBeenCalledWith('/api/v1/reports/subscriptions/r-1/csv', 'relatorio-operacao-semanal.csv'));
  });

  it('keeps the box as it was when saving fails', async () => {
    mocks.apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => { if (init?.method === 'PATCH') throw new Error('nope'); return { items: [item] }; });
    mount();
    const box = await screen.findByRole('checkbox', { name: /Operação semanal/ });
    fireEvent.click(box);
    expect(await screen.findByText('reports.toggleError')).toBeInTheDocument();
    expect(box).toBeChecked();
  });
});
