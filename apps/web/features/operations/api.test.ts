import { describe, expect, it, vi } from 'vitest';
import { acknowledgeOperationalAlert, getInventoryQuality, getInventoryQualityItems, readAllOperationalAlerts, resolveOperationalAlert, snoozeOperationalAlert } from './api';

const fetchMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/lib/api/client', () => ({ apiFetch: fetchMock }));

describe('operations API contracts', () => {
  it('uses PATCH alert state endpoints', async () => {
    await acknowledgeOperationalAlert('a'); await snoozeOperationalAlert('a', '2030-01-01'); await resolveOperationalAlert('a'); await readAllOperationalAlerts();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/operations/alerts/a/acknowledge', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/operations/alerts/a/snooze', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/operations/alerts/a/resolve', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/v1/operations/alerts/read-all', { method: 'PATCH' });
  });
  it('uses quality summary and findings resources', async () => {
    await getInventoryQuality('site'); await getInventoryQualityItems('site');
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/v1/inventory-quality/summary?siteId=site');
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/v1/inventory-quality/findings?siteId=site');
  });
});
