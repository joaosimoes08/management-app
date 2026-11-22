import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportUnsubscribe } from './report-unsubscribe';

vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: 'http://api.test' }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, _fallback?: string, params?: Record<string, string>) => params?.name ? `${key}:${params.name}` : key }) }));

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = 'abcdefghijklmnopqrstuvwxyz012345';

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); fetchMock.mockReset(); vi.unstubAllGlobals(); });

describe('ReportUnsubscribe', () => {
  it('only reads the token on open and unsubscribes when the button is pressed, without a session', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST' ? json(200, { reportName: 'Operação semanal', subscribed: false }) : json(200, { reportName: 'Operação semanal', subscribed: true }));
    render(<ReportUnsubscribe token={token} />);
    expect(await screen.findByText('reports.unsubscribe.question:Operação semanal')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://api.test/api/v1/reports/unsubscribe?token=${token}`);
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'reports.unsubscribe.confirm' }));
    expect(await screen.findByText('reports.unsubscribe.done:Operação semanal')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://api.test/api/v1/reports/unsubscribe');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ token }) });
    expect(JSON.stringify(init.headers)).not.toContain('Authorization');
  });

  it('shows the done state when already unsubscribed and an error for an invalid or missing token', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { reportName: 'Mensal', subscribed: false }));
    render(<ReportUnsubscribe token={token} />);
    expect(await screen.findByText('reports.unsubscribe.done:Mensal')).toBeInTheDocument();
    cleanup();

    fetchMock.mockResolvedValueOnce(json(404, { code: 'REPORT_UNSUBSCRIBE_INVALID' }));
    render(<ReportUnsubscribe token="bad" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('reports.unsubscribe.invalid');
    cleanup();

    render(<ReportUnsubscribe token={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('reports.unsubscribe.invalid');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets the person retry when the request fails', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json(500, {}) : json(200, { reportName: 'X', subscribed: true }));
    render(<ReportUnsubscribe token={token} />);
    fireEvent.click(await screen.findByRole('button', { name: 'reports.unsubscribe.confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('reports.unsubscribe.error');
    await waitFor(() => expect(screen.getByRole('button', { name: 'reports.unsubscribe.confirm' })).toBeEnabled());
  });
});
