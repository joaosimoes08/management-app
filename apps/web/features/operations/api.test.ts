import { describe, expect, it, vi } from 'vitest';
import { acknowledgeOperationalAlert, bulkOperationalAlerts, getOperationalAlert, listAlertSources, getInventoryQuality, getInventoryQualityItems, listOperationalAlerts, readAllOperationalAlerts, resolveOperationalAlert, snoozeOperationalAlert } from './api';

const fetchMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/lib/api/client', () => ({ apiFetch: fetchMock }));

describe('operations API contracts', () => {
  it('uses PATCH alert state endpoints', async () => {
    await acknowledgeOperationalAlert('a'); await snoozeOperationalAlert('a', 4); await resolveOperationalAlert('a'); await readAllOperationalAlerts();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/operations/alerts/a/acknowledge', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/operations/alerts/a/snooze', { method: 'PATCH', body: JSON.stringify({ durationHours: 4 }) });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/operations/alerts/a/resolve', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/v1/operations/alerts/read-all', { method: 'PATCH' });
  });
  it('uses quality summary and findings resources', async () => {
    await getInventoryQuality('site'); await getInventoryQualityItems('site');
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/v1/inventory-quality/summary?siteId=site');
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/v1/inventory-quality/findings?siteId=site');
    await listOperationalAlerts('site', 100);
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/v1/operations/alerts?siteId=site&page=1&pageSize=100');
  });
  it('sends bulk actions, reads one alert and lists the known sources', async () => {
    fetchMock.mockClear();
    await bulkOperationalAlerts({ action: 'SNOOZE', ids: ['a', 'b'], durationHours: 24 });
    await getOperationalAlert('a/b');
    await listAlertSources();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/operations/alerts/bulk', { method: 'POST', body: JSON.stringify({ action: 'SNOOZE', ids: ['a', 'b'], durationHours: 24 }) });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/operations/alerts/a%2Fb');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/operations/alerts/sources');
  });
});
