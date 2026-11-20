import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationsPanel } from './operations-panel';

const mocks = vi.hoisted(() => ({
  contextSiteId: 'context-site' as string | null,
  listOperationalAlerts: vi.fn(),
  getInventoryQuality: vi.fn(),
  getInventoryQualityItems: vi.fn(),
}));

vi.mock('./api', () => ({
  listOperationalAlerts: mocks.listOperationalAlerts,
  getInventoryQuality: mocks.getInventoryQuality,
  getInventoryQualityItems: mocks.getInventoryQualityItems,
  acknowledgeOperationalAlert: vi.fn(),
  readAllOperationalAlerts: vi.fn(),
  resolveOperationalAlert: vi.fn(),
  snoozeOperationalAlert: vi.fn(),
}));
vi.mock('./use-operational-events', () => ({ useOperationalEvents: () => ({ data: undefined, connected: false, error: null }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => false }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: mocks.contextSiteId }) }));

beforeEach(() => {
  mocks.contextSiteId = 'context-site';
  mocks.listOperationalAlerts.mockResolvedValue({ items: [], total: 0 });
  mocks.getInventoryQuality.mockResolvedValue({ score: 100 });
  mocks.getInventoryQualityItems.mockResolvedValue({ items: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('OperationsPanel site scope', () => {
  it('follows the global site selector when no siteId is passed (non-dashboard behaviour)', async () => {
    render(<OperationsPanel />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('context-site'));
    expect(mocks.getInventoryQuality).toHaveBeenCalledWith('context-site');
    expect(mocks.getInventoryQualityItems).not.toHaveBeenCalled();
  });

  it('uses the passed siteId instead of the global selector (dashboard workspace scope)', async () => {
    render(<OperationsPanel compact siteId="workspace-site" />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('workspace-site'));
    expect(mocks.getInventoryQuality).toHaveBeenCalledWith('workspace-site');
    expect(mocks.getInventoryQualityItems).toHaveBeenCalledWith('workspace-site');
    expect(mocks.listOperationalAlerts).not.toHaveBeenCalledWith('context-site');
  });

  it('falls back to the global selector when the passed siteId is empty', async () => {
    render(<OperationsPanel compact siteId="" />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('context-site'));
  });

  it('requests all sites when neither a siteId nor a global site is set', async () => {
    mocks.contextSiteId = null;
    render(<OperationsPanel showQuality={false} />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith(undefined));
    expect(mocks.getInventoryQuality).not.toHaveBeenCalled();
  });
});
