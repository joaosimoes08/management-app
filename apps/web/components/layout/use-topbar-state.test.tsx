import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATIONS_CHANGED } from '@/features/profile/api';
import { useTopbarState } from './use-topbar-state';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), events: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/features/operations/use-operational-events', () => ({ useOperationalEvents: mocks.events }));

const state = { environment: { state: 'OPERATIONAL', services: [] }, alerts: [{ id: 'a1', severity: 'WARNING', title: 'Link', detail: 'x', href: '/alertas', occurredAt: '2026-11-20T00:00:00.000Z' }], processes: [], updatedAt: '2026-11-27T00:00:00.000Z' };

type EventsOptions = { fallback: () => unknown; onEvent: (event: { data: unknown }) => void };
const lastEvents = () => mocks.events.mock.calls.at(-1)![0] as EventsOptions;

function setup(onAlertEvent?: (alertId: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useTopbarState({ onAlertEvent }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('useTopbarState', () => {
  it('returns the topbar state from GET /api/v1/dashboard/topbar-state', async () => {
    mocks.apiFetch.mockResolvedValue(state);
    const { result } = setup();
    await waitFor(() => expect(result.current.alerts.map((alert) => alert.id)).toEqual(['a1']));
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/dashboard/topbar-state');
  });

  it('shows the unavailable state, without retrying, when the request fails', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('down'));
    const { result } = setup();
    expect(result.current.environment.state).toBe('UNAVAILABLE');
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(1));
    expect(result.current.alerts[0].id).toBe('environment-unavailable');
  });

  it('reloads on window focus and when notifications change', async () => {
    mocks.apiFetch.mockResolvedValue(state);
    const { result } = setup();
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    const before = mocks.apiFetch.mock.calls.length;
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(mocks.apiFetch.mock.calls.length).toBe(before + 1));
    act(() => { window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); });
    await waitFor(() => expect(mocks.apiFetch.mock.calls.length).toBe(before + 2));
  });

  it('reloads every 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    mocks.apiFetch.mockResolvedValue(state);
    const { result } = setup();
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    const before = mocks.apiFetch.mock.calls.length;
    act(() => { vi.advanceTimersByTime(30_000); });
    await waitFor(() => expect(mocks.apiFetch.mock.calls.length).toBe(before + 1));
  });

  it('passes an operational event alert id to onAlertEvent and loads a fresh state', async () => {
    mocks.apiFetch.mockResolvedValue(state);
    const onAlertEvent = vi.fn();
    const { result } = setup(onAlertEvent);
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    const before = mocks.apiFetch.mock.calls.length;
    act(() => { lastEvents().onEvent({ data: { alertId: 'a1' } }); });
    expect(onAlertEvent).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(mocks.apiFetch.mock.calls.length).toBe(before + 1));
    act(() => { lastEvents().onEvent({ data: null }); });
    expect(onAlertEvent).toHaveBeenCalledTimes(1);
  });

  it('uses the topbar state as the events fallback poll', async () => {
    mocks.apiFetch.mockResolvedValue(state);
    const { result } = setup();
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    await expect(lastEvents().fallback()).resolves.toMatchObject({ alerts: [{ id: 'a1' }] });
  });
});
