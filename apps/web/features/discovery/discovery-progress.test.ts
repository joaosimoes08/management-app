import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { cancelDiscoveryJob, discoveryJobProgress, retryDiscoveryJob } from './api';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);
beforeEach(() => mockedFetch.mockReset());

describe('Discovery scan progress (Round 2 #10/#11)', () => {
  it('shows saved progress while running and how a scan stopped', () => {
    expect(discoveryJobProgress({ status: 'RUNNING', totalCount: 62, processedCount: 32 })).toBe('32/62 endereços');
    expect(discoveryJobProgress({ status: 'RUNNING', totalCount: 62, processedCount: 32, cancelRequestedAt: '2026-11-22T10:00:00Z' })).toBe('32/62 endereços · cancelamento pedido');
    expect(discoveryJobProgress({ status: 'COMPLETED', totalCount: 62, processedCount: 16, stopReason: 'LIMIT_PROBES' })).toBe('16/62 endereços · parado no limite de sondas');
    expect(discoveryJobProgress({ status: 'COMPLETED', totalCount: 62, processedCount: 60, stopReason: 'LIMIT_DURATION' })).toBe('60/62 endereços · parado no limite de duração');
    expect(discoveryJobProgress({ status: 'CANCELLED', totalCount: 62, processedCount: 32, stopReason: 'CANCELLED' })).toBe('32/62 endereços · cancelada');
    expect(discoveryJobProgress({ status: 'COMPLETED', totalCount: 62, processedCount: 62 })).toBe('');
    expect(discoveryJobProgress({ status: 'COMPLETED' })).toBe('');
  });

  it('cancels and retries through the API', async () => {
    mockedFetch.mockResolvedValue({ id: 'job-1', status: 'CANCELLED' });
    await cancelDiscoveryJob('job-1');
    await retryDiscoveryJob('job-1');
    expect(mockedFetch).toHaveBeenNthCalledWith(1, '/api/v1/discovery/jobs/job-1/cancel', { method: 'POST' });
    expect(mockedFetch).toHaveBeenNthCalledWith(2, '/api/v1/discovery/jobs/job-1/retry', { method: 'POST' });
  });
});
