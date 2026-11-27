import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cadence } from '../types';
import { CriticalCadenceSettings } from './critical-cadence-settings';

const mocks = vi.hoisted(() => ({ getCriticalCadence: vi.fn(), updateCriticalCadence: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), getCriticalCadence: mocks.getCriticalCadence, updateCriticalCadence: mocks.updateCriticalCadence }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string, fallback?: string) => fallback ?? key }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const sites = [{ id: 's-1', name: 'Lisboa' }, { id: 's-2', name: 'Porto' }];
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<CriticalCadenceSettings sites={sites} />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return client;
};
/** React Query tells components about new data on a timer; let that run so the form would show a reseed. */
const flushQueryNotifications = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const t1 = () => screen.getAllByRole('spinbutton')[0] as HTMLInputElement;

describe('CriticalCadenceSettings', () => {
  it('keeps an unsaved edit when the cadence is refetched in the background', async () => {
    mocks.getCriticalCadence.mockResolvedValue({ T1: 4, T2: 12, T3: 26 } satisfies Cadence);
    const client = setup();
    await waitFor(() => expect(t1().value).toBe('4'));
    fireEvent.change(t1(), { target: { value: '6' } });

    // The server now answers something else, and the query refetches without anyone asking (reconnect, invalidation).
    mocks.getCriticalCadence.mockResolvedValue({ T1: 8, T2: 12, T3: 26 } satisfies Cadence);
    await act(() => client.refetchQueries({ queryKey: ['settings', 'critical-cadence', 's-1'] }));
    await flushQueryNotifications();
    expect(client.getQueryData(['settings', 'critical-cadence', 's-1'])).toEqual({ T1: 8, T2: 12, T3: 26 });
    expect(mocks.getCriticalCadence).toHaveBeenCalledTimes(2);
    expect(t1().value).toBe('6');
  });

  it('fills the form for each Site chosen and from the saved answer', async () => {
    mocks.getCriticalCadence.mockImplementation(async (siteId: string) => (siteId === 's-1' ? { T1: 4, T2: 12, T3: 26 } : { T1: 2, T2: 8, T3: 20 }));
    setup();
    await waitFor(() => expect(t1().value).toBe('4'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 's-2' } });
    await waitFor(() => expect(t1().value).toBe('2'));

    mocks.updateCriticalCadence.mockResolvedValue({ T1: 3, T2: 8, T3: 20 } satisfies Cadence);
    fireEvent.change(t1(), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.updateCriticalCadence).toHaveBeenCalledWith('s-2', { T1: 3, T2: 8, T3: 20 }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(t1().value).toBe('3');
  });
});
