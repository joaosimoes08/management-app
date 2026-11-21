import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureLabel, NotificationChannelsSettings, type ChannelStatus, type DeliveryItem } from './notification-channels-settings';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('@/components/layout/app-shell', () => ({ PageToolbarPortal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string, fallback?: string) => fallback ?? key }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const channel = (target: ChannelStatus['target'], overrides: Partial<ChannelStatus> = {}): ChannelStatus => ({ kind: 'TEAMS', target, enabled: false, configured: false, minSeverity: target === 'GROUP_ALERTS' ? 'HIGH' : null, updatedAt: null, ...overrides });
const failed: DeliveryItem = { id: 'd-1', target: 'GROUP_ALERTS', status: 'FAILED', topic: 'OPERATIONAL_ALERT', title: '[CRITICAL] Core down', attempts: 5, failureReason: 'HTTP_500', createdAt: '2026-11-21T10:00:00.000Z', sentAt: null, nextAttemptAt: null, recipient: null };

function api(channels: ChannelStatus[], items: DeliveryItem[] = []) {
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/v1/settings/notification-channels') return { channels, keyringAvailable: true, publicLinks: true, maxAttempts: 5 };
    if (path.startsWith('/api/v1/settings/notification-deliveries?') || path === '/api/v1/settings/notification-deliveries') return { items, nextCursor: null, counts: { FAILED: items.length } };
    if (path.endsWith('/test')) return { deliveryId: 't-1', status: 'FAILED', failureReason: 'HTTP_404' };
    return {};
  });
}

describe('NotificationChannelsSettings', () => {
  it('starts off, keeps the webhook write-only and saves only the channel that changed', async () => {
    api([channel('USER_NOTIFICATIONS'), channel('GROUP_ALERTS')]);
    const { container } = render(<NotificationChannelsSettings />);
    const group = await screen.findByRole('group', { name: 'Alertas operacionais' });
    await waitFor(() => expect(within(group).getByText('Sem webhook · desativado')).toBeInTheDocument());
    expect(within(group).getByRole('checkbox', { name: 'Ativar este canal' })).not.toBeChecked();
    expect(within(group).getByRole('button', { name: 'Enviar mensagem de teste' })).toBeDisabled();
    const url = within(group).getByLabelText(/URL do webhook/) as HTMLInputElement;
    expect(url.type).toBe('password');
    expect(url.value).toBe('');
    // The form is submitted from the page toolbar, so the submit button must point at the form id.
    expect(container.querySelector('form#settings-notifications-form')).not.toBeNull();

    fireEvent.change(url, { target: { value: ' https://contoso.webhook.office.com/webhookb2/x ' } });
    fireEvent.change(within(group).getByRole('combobox', { name: 'Severidade mínima' }), { target: { value: 'CRITICAL' } });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Ativar este canal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Notificações', 'Canais de notificação guardados'));
    const puts = mocks.apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(puts).toEqual([['/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS', { method: 'PUT', body: JSON.stringify({ enabled: true, webhookUrl: 'https://contoso.webhook.office.com/webhookb2/x', minSeverity: 'CRITICAL' }) }]]);
  });

  it('sends a test message, reports the failure reason and retries failed deliveries from the log', async () => {
    api([channel('USER_NOTIFICATIONS'), channel('GROUP_ALERTS', { configured: true, enabled: true })], [failed]);
    render(<NotificationChannelsSettings />);
    const log = await screen.findByRole('region', { name: 'Registo de entregas' });
    expect(within(log).getByText('O Teams respondeu HTTP 500')).toBeInTheDocument();
    expect(within(log).getByText('5/5')).toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Alertas operacionais' });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Enviar mensagem de teste' })).toBeEnabled());
    fireEvent.click(within(group).getByRole('button', { name: 'Enviar mensagem de teste' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Microsoft Teams', 'Mensagem de teste falhou: O Teams respondeu HTTP 404'));
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS/test', { method: 'POST' });

    fireEvent.click(within(log).getByRole('button', { name: 'Repetir' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-deliveries/d-1/retry', { method: 'POST' }));
    fireEvent.change(screen.getByRole('combobox', { name: /^Estado/ }), { target: { value: 'FAILED' } });
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-deliveries?status=FAILED'));
  });

  it('labels failure codes without exposing anything else', () => {
    expect(failureLabel('TIMEOUT')).toBe('Sem resposta em 10 s');
    expect(failureLabel('HTTP_429')).toBe('O Teams respondeu HTTP 429');
    expect(failureLabel(null)).toBe('—');
    expect(failureLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('saves the SMTP server with a write-only password, then group recipients, and tests e-mail', async () => {
    const emailServer: ChannelStatus = { kind: 'EMAIL', target: 'USER_NOTIFICATIONS', enabled: false, configured: false, minSeverity: null, updatedAt: null, smtp: null };
    const emailGroup: ChannelStatus = { kind: 'EMAIL', target: 'GROUP_ALERTS', enabled: false, configured: false, minSeverity: 'HIGH', updatedAt: null, recipients: [], serverConfigured: false };
    api([channel('USER_NOTIFICATIONS'), channel('GROUP_ALERTS'), emailServer, emailGroup]);
    render(<NotificationChannelsSettings />);
    const server = await screen.findByRole('group', { name: 'Servidor SMTP e emails pessoais' });
    await waitFor(() => expect(within(server).getByText('Sem servidor · desativado')).toBeInTheDocument());
    expect(within(server).getByRole('button', { name: 'Enviar email de teste' })).toBeDisabled();
    const password = within(server).getByLabelText('Palavra-passe') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.change(within(server).getByLabelText('Servidor'), { target: { value: ' smtp.empresa.pt ' } });
    fireEvent.change(within(server).getByRole('combobox', { name: 'Segurança' }), { target: { value: 'TLS' } });
    expect((within(server).getByLabelText('Porta') as HTMLInputElement).value).toBe('465');
    fireEvent.change(within(server).getByLabelText('Remetente'), { target: { value: 'alertas@empresa.pt' } });
    fireEvent.change(within(server).getByLabelText('Utilizador'), { target: { value: 'alertas@empresa.pt' } });
    fireEvent.change(password, { target: { value: 's3cret' } });
    fireEvent.click(within(server).getByRole('checkbox', { name: 'Ativar emails pessoais' }));
    const group = screen.getByRole('group', { name: 'Alertas operacionais por email' });
    expect(within(group).getByText('Configura primeiro o servidor SMTP')).toBeInTheDocument();
    fireEvent.change(within(group).getByLabelText(/Destinatários/), { target: { value: 'noc@empresa.pt, oncall@empresa.pt' } });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Ativar alertas por email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Notificações', 'Canais de notificação guardados'));
    const puts = mocks.apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(puts).toEqual([
      ['/api/v1/settings/notification-channels/EMAIL/USER_NOTIFICATIONS', { method: 'PUT', body: JSON.stringify({ enabled: true, smtp: { host: 'smtp.empresa.pt', port: 465, security: 'TLS', username: 'alertas@empresa.pt', password: 's3cret', from: 'alertas@empresa.pt' } }) }],
      ['/api/v1/settings/notification-channels/EMAIL/GROUP_ALERTS', { method: 'PUT', body: JSON.stringify({ enabled: true, minSeverity: 'HIGH', recipients: ['noc@empresa.pt', 'oncall@empresa.pt'] }) }],
    ]);
  });

  it('tests a saved SMTP server and keeps the stored password out of the form', async () => {
    const emailServer: ChannelStatus = { kind: 'EMAIL', target: 'USER_NOTIFICATIONS', enabled: true, configured: true, minSeverity: null, updatedAt: null, smtp: { host: 'smtp.empresa.pt', port: 587, security: 'STARTTLS', username: 'u', from: 'a@empresa.pt', passwordSet: true } };
    api([channel('USER_NOTIFICATIONS'), channel('GROUP_ALERTS'), emailServer]);
    render(<NotificationChannelsSettings />);
    const server = await screen.findByRole('group', { name: 'Servidor SMTP e emails pessoais' });
    await waitFor(() => expect((within(server).getByLabelText('Servidor') as HTMLInputElement).value).toBe('smtp.empresa.pt'));
    const password = within(server).getByLabelText('Palavra-passe') as HTMLInputElement;
    expect(password.value).toBe('');
    expect(password.placeholder).toMatch(/Guardada/);
    fireEvent.click(within(server).getByRole('button', { name: 'Enviar email de teste' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-channels/EMAIL/USER_NOTIFICATIONS/test', { method: 'POST' }));
    // Unchanged settings are not re-sent.
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Notificações', 'Canais de notificação guardados'));
    expect(mocks.apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT')).toEqual([]);
  });

  it('labels SMTP failure codes', () => {
    expect(failureLabel('SMTP_EAUTH_535')).toBe('O servidor SMTP recusou o utilizador ou a palavra-passe (535)');
    expect(failureLabel('SMTP_550')).toBe('O servidor SMTP respondeu 550');
    expect(failureLabel('SMTP_ECONNECTION')).toBe('Ligação ao servidor SMTP falhou');
    expect(failureLabel('RECIPIENT_NO_EMAIL')).toBe('Destinatário sem email definido');
  });

  it('asks for the password again when the SMTP server or account changes, and labels the new codes', async () => {
    const emailServer: ChannelStatus = { kind: 'EMAIL', target: 'USER_NOTIFICATIONS', enabled: true, configured: true, minSeverity: null, updatedAt: null, smtp: { host: 'smtp.empresa.pt', port: 587, security: 'STARTTLS', username: 'u', from: 'a@empresa.pt', passwordSet: true } };
    api([channel('USER_NOTIFICATIONS'), channel('GROUP_ALERTS'), emailServer]);
    render(<NotificationChannelsSettings />);
    const server = await screen.findByRole('group', { name: 'Servidor SMTP e emails pessoais' });
    await waitFor(() => expect((within(server).getByLabelText('Servidor') as HTMLInputElement).value).toBe('smtp.empresa.pt'));
    expect(within(server).queryByText(/não é reutilizada/)).not.toBeInTheDocument();
    fireEvent.change(within(server).getByLabelText('Remetente'), { target: { value: 'b@empresa.pt' } });
    expect(within(server).queryByText(/não é reutilizada/)).not.toBeInTheDocument();
    fireEvent.change(within(server).getByLabelText('Servidor'), { target: { value: 'smtp2.empresa.pt' } });
    expect(within(server).getByText(/não é reutilizada/)).toBeInTheDocument();
    expect((within(server).getByLabelText('Palavra-passe') as HTMLInputElement).placeholder).toBe('Introduz de novo a palavra-passe');
    expect(failureLabel('SMTP_CONNECTION_FAILED')).toMatch(/Não foi possível ligar/);
    expect(failureLabel('SMTP_HOST_NOT_ALLOWED')).toMatch(/não permitido/);
  });
});
