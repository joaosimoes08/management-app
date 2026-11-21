import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduledReportsSettings, type ScheduledReport, type ScheduledReportsResponse } from './scheduled-reports-settings';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), apiDownload: vi.fn(), success: vi.fn(), error: vi.fn(), confirm: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch, apiDownload: mocks.apiDownload }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: mocks.confirm, confirmDialog: null }) }));
vi.mock('@/components/layout/app-shell', () => ({ PageToolbarPortal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string, fallback?: string) => fallback ?? key }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const report: ScheduledReport = {
  id: 'r-1', name: 'Operação semanal', enabled: true, frequency: 'WEEKLY', dayOfWeek: 1, dayOfMonth: null, hour: 8, timezone: 'Europe/Lisbon',
  sections: ['COMPLIANCE', 'CHANGES'], siteIds: ['s-a'], sendEmail: true, sendTeams: true, nextRunAt: '2026-11-23T08:00:00.000Z', lastRunAt: null,
  recipients: [
    { userId: 'u-1', username: 'ana', displayName: 'Ana', hasEmail: true, unsubscribedAt: null },
    { userId: 'u-2', username: 'rui', displayName: null, hasEmail: false, unsubscribedAt: '2026-11-20T10:00:00.000Z' },
  ],
  lastRun: null,
};
const base = (overrides: Partial<ScheduledReportsResponse> = {}): ScheduledReportsResponse => ({
  reports: [report], sites: [{ id: 's-a', name: 'Lisboa' }, { id: 's-b', name: 'Porto' }],
  users: [{ id: 'u-1', username: 'ana', displayName: 'Ana', hasEmail: true }, { id: 'u-2', username: 'rui', displayName: null, hasEmail: false }, { id: 'u-3', username: 'eva', displayName: 'Eva', hasEmail: true }],
  channels: { email: true, teams: true }, publicLinks: true, maxRecipients: 100, ...overrides,
});

function api(state: ScheduledReportsResponse) {
  mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/settings/scheduled-reports' && !init?.method) return state;
    if (path.endsWith('/run')) return { runId: 'run-1', periodStart: '2026-11-14', periodEnd: '2026-11-20', teams: 'QUEUED', recipients: [{ userId: 'u-1', siteIds: ['s-a'], email: 'QUEUED' }] };
    return {};
  });
}

describe('ScheduledReportsSettings', () => {
  it('lists reports with schedule, Sites, unsubscribed recipients and channels, and warns when no channel or public URL is set', async () => {
    api(base({ channels: { email: false, teams: false }, publicLinks: false }));
    render(<ScheduledReportsSettings />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Operação semanal')).toBeInTheDocument();
    expect(within(table).getByText('Semanal · segunda-feira às 08:00 (Europe/Lisbon)')).toBeInTheDocument();
    expect(within(table).getByText('Lisboa')).toBeInTheDocument();
    expect(within(table).getByText('1 cancelou a subscrição')).toBeInTheDocument();
    expect(within(table).getByText('Email + Teams')).toBeInTheDocument();
    expect(screen.getByText(/Nenhum canal de envio está ativo/)).toBeInTheDocument();
    expect(screen.getByText(/APP_PUBLIC_URL não está definido/)).toHaveClass('ipam-alert', 'warning');
  });

  it('creates a monthly report with the chosen sections, Sites and recipients', async () => {
    api(base({ reports: [] }));
    render(<ScheduledReportsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Novo relatório/ }));
    const form = screen.getByRole('form', { name: 'Novo relatório' });
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: ' Mensal Porto ' } });
    fireEvent.change(within(form).getByLabelText('Frequência'), { target: { value: 'MONTHLY' } });
    fireEvent.change(within(form).getByLabelText(/Dia do mês/), { target: { value: '5' } });
    fireEvent.change(within(form).getByLabelText('Fuso horário'), { target: { value: 'Europe/Lisbon' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: /Alterações/ }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Porto' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: /Eva \(eva\)/ }));
    fireEvent.click(within(form).getByRole('button', { name: /Guardar relatório/ }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Relatórios', 'Relatório criado'));
    const [path, init] = mocks.apiFetch.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(path).toBe('/api/v1/settings/scheduled-reports');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Mensal Porto', enabled: true, frequency: 'MONTHLY', hour: 8, timezone: 'Europe/Lisbon', dayOfMonth: 5,
      sections: ['COMPLIANCE', 'LIFECYCLE', 'QUALITY', 'CAPACITY'], siteIds: ['s-b'], recipientIds: ['u-3'], sendEmail: true, sendTeams: false,
    });
  });

  it('refuses to save without a section or a channel', async () => {
    api(base({ reports: [] }));
    render(<ScheduledReportsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Novo relatório/ }));
    const form = screen.getByRole('form', { name: 'Novo relatório' });
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'X' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: /Email a cada destinatário/ }));
    fireEvent.click(within(form).getByRole('button', { name: /Guardar relatório/ }));
    expect(await screen.findByText('Escolhe pelo menos um canal de envio.')).toBeInTheDocument();
    expect(mocks.apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('edits with PUT, sends now after confirmation, downloads the CSV and removes after confirmation', async () => {
    api(base());
    mocks.confirm.mockResolvedValue(true);
    render(<ScheduledReportsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Operação semanal' }));
    const form = screen.getByRole('form', { name: 'Editar relatório' });
    expect(within(form).getByRole('checkbox', { name: /Ana \(ana\)/ })).toBeChecked();
    fireEvent.click(within(form).getByRole('button', { name: /Guardar relatório/ }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/scheduled-reports/r-1', expect.objectContaining({ method: 'PUT' })));
    expect(JSON.parse(String(mocks.apiFetch.mock.calls.find(([, options]) => options?.method === 'PUT')![1].body)).recipientIds).toEqual(['u-1', 'u-2']);

    fireEvent.click(await screen.findByRole('button', { name: 'Enviar Operação semanal agora' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Relatórios', '1 email(s) em envio e resumo no Teams'));
    expect(mocks.confirm.mock.calls[0][0].message).toContain('a 1 destinatário(s)');

    fireEvent.click(screen.getByRole('button', { name: 'Descarregar CSV de Operação semanal' }));
    await waitFor(() => expect(mocks.apiDownload).toHaveBeenCalledWith('/api/v1/settings/scheduled-reports/r-1/csv', 'relatorio-operacao-semanal.csv'));

    fireEvent.click(screen.getByRole('button', { name: 'Remover Operação semanal' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/scheduled-reports/r-1', { method: 'DELETE' }));
  });

  it('does nothing when sending is not confirmed', async () => {
    api(base());
    mocks.confirm.mockResolvedValue(false);
    render(<ScheduledReportsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar Operação semanal agora' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.apiFetch.mock.calls.some(([path]) => String(path).endsWith('/run'))).toBe(false);
  });
});
