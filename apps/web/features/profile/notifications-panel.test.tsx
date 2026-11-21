import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { NOTIFICATIONS_CHANGED } from './api';
import { NotificationsPanel } from './notifications-panel';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, formatDate: (value: string) => value }) }));

const first = {
  id: 'notice-a', title: 'Review due', type: 'CRITICAL_ASSET_ATTESTATION', message: 'Review this record.',
  createdAt: '2025-09-01T08:00:00.000Z', readAt: null as string | null, href: '/attestacao-ativos?assetId=a',
};
const second = {
  ...first, id: 'notice-b', title: 'Warranty reminder', type: 'LIFECYCLE_DATE', href: '/infraestrutura?tab=lifecycle',
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><NotificationsPanel userId="user-1" /></QueryClientProvider>);
}

beforeEach(() => { vi.mocked(apiFetch).mockReset(); });
afterEach(cleanup);

describe('NotificationsPanel', () => {
  it('opens only the selected notification, keeps its source available and publishes the new read state', async () => {
    const rows = [first, second].map((item) => ({ ...item }));
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path.endsWith('/preferences')) return [];
      if (path.endsWith('/read')) {
        const row = rows.find((item) => path.includes(item.id))!;
        row.readAt = JSON.parse(String(options?.body)).read ? first.createdAt : null;
        return {};
      }
      const unreadOnly = path.includes('status=unread');
      return { items: rows.filter((item) => !unreadOnly || !item.readAt).map((item) => ({ ...item })), nextCursor: null };
    });
    const changed = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    try {
      mount();
      const status = screen.getByRole('combobox', { name: 'notifications.status' });
      fireEvent.change(status, { target: { value: 'unread' } });
      fireEvent.click(await screen.findByRole('button', { name: first.title }));
      const detail = await screen.findByRole('region', { name: first.title });
      expect(within(detail).getByRole('link', { name: 'notifications.openSource' })).toHaveAttribute('href', first.href);
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications/notice-a/read', { method: 'PATCH', body: '{"read":true}' });
      expect(apiFetch).not.toHaveBeenCalledWith('/api/v1/notifications/notice-b/read', expect.anything());
      expect(screen.getByRole('button', { name: second.title })).toBeInTheDocument();
      fireEvent.change(status, { target: { value: 'all' } });
      const readItem = await screen.findByRole('button', { name: 'notifications.markUnread' });
      fireEvent.click(readItem);
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
      expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications/notice-a/read', { method: 'PATCH', body: '{"read":false}' });
    } finally {
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
    }
  });

  it('loads older pages, filters by type, and saves each preference independently', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path.endsWith('/preferences')) return [{ type: 'LIFECYCLE_DATE', muted: false }];
      if (path.endsWith('/preferences/LIFECYCLE_DATE')) return { type: 'LIFECYCLE_DATE', muted: true };
      if (path.includes('type=LIFECYCLE_DATE')) return { items: [], nextCursor: null };
      if (path.includes('cursor=notice-a')) return { items: [second], nextCursor: null };
      return { items: [first], nextCursor: first.id };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'notifications.loadMore' }));
    expect(await screen.findByRole('button', { name: second.title })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications?status=all&cursor=notice-a');
    fireEvent.change(screen.getByRole('combobox', { name: 'notifications.type' }), { target: { value: 'LIFECYCLE_DATE' } });
    expect(await screen.findByText('notifications.empty')).toBeInTheDocument();

    const preference = await screen.findByRole('checkbox', { name: 'notifications.type.LIFECYCLE_DATE' });
    fireEvent.click(preference);
    await waitFor(() => expect(preference).not.toBeChecked());
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/notifications/preferences/LIFECYCLE_DATE', { method: 'PATCH', body: '{"muted":true}' });
  });
});
