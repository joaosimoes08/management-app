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
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Notificações', 'Canais Microsoft Teams guardados'));
    const puts = mocks.apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(puts).toEqual([['/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS', { method: 'PUT', body: JSON.stringify({ enabled: true, webhookUrl: 'https://contoso.webhook.office.com/webhookb2/x', minSeverity: 'CRITICAL' }) }]]);
  });

  it('sends a test message, reports the failure reason and retries failed deliveries from the log', async () => {
    api([channel('USER_NOTIFICATIONS'), channel('GROUP_ALERTS', { configured: true, enabled: true })], [failed]);
    render(<NotificationChannelsSettings />);
    const log = await screen.findByRole('region', { name: 'Registo de entregas Microsoft Teams' });
    expect(within(log).getByText('O Teams respondeu HTTP 500')).toBeInTheDocument();
    expect(within(log).getByText('5/5')).toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Alertas operacionais' });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Enviar mensagem de teste' })).toBeEnabled());
    fireEvent.click(within(group).getByRole('button', { name: 'Enviar mensagem de teste' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Microsoft Teams', 'Mensagem de teste falhou: O Teams respondeu HTTP 404'));
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-channels/TEAMS/GROUP_ALERTS/test', { method: 'POST' });

    fireEvent.click(within(log).getByRole('button', { name: 'Repetir' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-deliveries/d-1/retry', { method: 'POST' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Estado/ }), { target: { value: 'FAILED' } });
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/settings/notification-deliveries?status=FAILED'));
  });

  it('labels failure codes without exposing anything else', () => {
    expect(failureLabel('TIMEOUT')).toBe('Sem resposta em 10 s');
    expect(failureLabel('HTTP_429')).toBe('O Teams respondeu HTTP 429');
    expect(failureLabel(null)).toBe('—');
    expect(failureLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
