import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationsPanel } from './operations-panel';

const mocks = vi.hoisted(() => ({
  contextSiteId: 'context-site' as string | null,
  listOperationalAlerts: vi.fn(),
  getInventoryQuality: vi.fn(),
  getInventoryQualityItems: vi.fn(),
  resolveOperationalAlert: vi.fn(),
  roles: [] as string[],
}));

vi.mock('./api', () => ({
  listOperationalAlerts: mocks.listOperationalAlerts,
  getInventoryQuality: mocks.getInventoryQuality,
  getInventoryQualityItems: mocks.getInventoryQualityItems,
  acknowledgeOperationalAlert: vi.fn(),
  readAllOperationalAlerts: vi.fn(),
  resolveOperationalAlert: mocks.resolveOperationalAlert,
  snoozeOperationalAlert: vi.fn(),
}));
type EventOptions = { fallback?: () => Promise<unknown>; onEvent?: (event: { event: string; data: unknown }) => void };
const events = vi.hoisted(() => ({ options: {} as { fallback?: () => Promise<unknown>; onEvent?: (event: { event: string; data: unknown }) => void } }));
vi.mock('./use-operational-events', () => ({ useOperationalEvents: (options: EventOptions) => { events.options = options; return { data: undefined, connected: false, error: null }; } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => mocks.roles.includes(role) }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: mocks.contextSiteId }) }));

beforeEach(() => {
  mocks.contextSiteId = 'context-site';
  mocks.roles = [];
  mocks.resolveOperationalAlert.mockResolvedValue({});
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
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('workspace-site', 25, 1, 'OPEN'));
    expect(mocks.getInventoryQuality).toHaveBeenCalledWith('workspace-site');
    expect(mocks.getInventoryQualityItems).toHaveBeenCalledWith('workspace-site');
    expect(mocks.listOperationalAlerts.mock.calls.every(([site]) => site === 'workspace-site')).toBe(true);
  });

  it('falls back to the global selector when the passed siteId is empty', async () => {
    render(<OperationsPanel compact siteId="" />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('context-site', 25, 1, 'OPEN'));
  });

  it('renders no section kickers in either variant', async () => {
    const compact = render(<OperationsPanel compact siteId="workspace-site" />);
    await waitFor(() => expect(mocks.getInventoryQualityItems).toHaveBeenCalled());
    expect(compact.container.querySelector('.section-kicker')).toBeNull();
    compact.unmount();
    const full = render(<OperationsPanel />);
    await waitFor(() => expect(mocks.getInventoryQuality).toHaveBeenCalledTimes(2));
    expect(full.container.querySelector('.section-kicker')).toBeNull();
  });

  it('requests all sites when neither a siteId nor a global site is set', async () => {
    mocks.contextSiteId = null;
    render(<OperationsPanel showQuality={false} />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith(undefined));
    expect(mocks.getInventoryQuality).not.toHaveBeenCalled();
  });
});

const alert = (id: string, title: string, severity = 'HIGH', status = 'OPEN') => ({ id, title, severity, status, detail: null });
const page = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 25 });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

describe('OperationsPanel dashboard alert count', () => {
  it('counts only OPEN + ACKNOWLEDGED alerts (SNOOZED excluded) so the card adds up with the severity tiles', async () => {
    mocks.listOperationalAlerts.mockImplementation((_site: string, _size: number, _page: number, status?: string) => Promise.resolve(
      status === 'OPEN' ? page([alert('a1', 'Open alert')], 2) : status === 'ACKNOWLEDGED' ? page([alert('a2', 'Acked alert', 'CRITICAL', 'ACKNOWLEDGED')], 1) : page([alert('s1', 'Snoozed alert', 'HIGH', 'SNOOZED')], 9),
    ));
    render(<OperationsPanel compact showQuality={false} siteId="site-1" />);
    expect(await screen.findByText('Open alert')).toBeInTheDocument();
    expect(screen.getByText('Acked alert')).toBeInTheDocument();
    expect(screen.queryByText('Snoozed alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Alertas ativos/ })).toHaveTextContent('· 2 de 3');
    const statuses = mocks.listOperationalAlerts.mock.calls.map((call) => call[3]);
    expect(statuses.sort()).toEqual(['ACKNOWLEDGED', 'OPEN']);
  });

  it('keeps the non-dashboard alert list unchanged (single unfiltered request)', async () => {
    render(<OperationsPanel showQuality={false} />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledTimes(1));
    expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('context-site');
  });
});

describe('OperationsPanel scope changes and failures', () => {
  it('clears the previous site data and shows the error when the new site request fails', async () => {
    mocks.listOperationalAlerts.mockImplementation((site: string, _size: number, _page: number, status?: string) => site === 'site-1' ? Promise.resolve(page(status === 'OPEN' ? [alert('a1', 'Site one alert')] : [])) : Promise.reject(new Error('boom')));
    mocks.getInventoryQuality.mockImplementation((site: string) => site === 'site-1' ? Promise.resolve({ score: 80, validDeviceCount: 7 }) : Promise.reject(new Error('boom')));
    const view = render(<OperationsPanel compact siteId="site-1" />);
    expect(await screen.findByText('Site one alert')).toBeInTheDocument();
    expect(screen.getByText('7 dispositivos sem problemas')).toBeInTheDocument();
    view.rerender(<OperationsPanel compact siteId="site-2" />);
    expect(await screen.findByText('Não foi possível carregar os alertas. Tenta atualizar.')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar a qualidade dos dados. Tenta atualizar.')).toBeInTheDocument();
    expect(screen.queryByText('Site one alert')).not.toBeInTheDocument();
    expect(screen.queryByText('7 dispositivos sem problemas')).not.toBeInTheDocument();
  });

  it('ignores a slower response for the previous site (out-of-order responses)', async () => {
    const slowSiteOne = deferred<ReturnType<typeof page>>();
    mocks.listOperationalAlerts.mockImplementation((site: string, _size: number, _page: number, status?: string) => site === 'site-1'
      ? (status === 'OPEN' ? slowSiteOne.promise : Promise.resolve(page([])))
      : Promise.resolve(page(status === 'OPEN' ? [alert('a2', 'Site two alert')] : [])));
    const view = render(<OperationsPanel compact showQuality={false} siteId="site-1" />);
    await waitFor(() => expect(mocks.listOperationalAlerts).toHaveBeenCalledWith('site-1', 25, 1, 'OPEN'));
    view.rerender(<OperationsPanel compact showQuality={false} siteId="site-2" />);
    expect(await screen.findByText('Site two alert')).toBeInTheDocument();
    await act(async () => { slowSiteOne.resolve(page([alert('a1', 'Stale site one alert')])); await slowSiteOne.promise; });
    expect(screen.queryByText('Stale site one alert')).not.toBeInTheDocument();
    expect(screen.getByText('Site two alert')).toBeInTheDocument();
  });

  it('updates one card when the other card request fails (allSettled)', async () => {
    mocks.listOperationalAlerts.mockResolvedValue(page([alert('a1', 'Still shown alert')]));
    mocks.getInventoryQuality.mockRejectedValue(new Error('quality down'));
    render(<OperationsPanel />);
    expect(await screen.findByText('Still shown alert')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar a qualidade dos dados. Tenta atualizar.')).toBeInTheDocument();
  });

  it('shows the load error even when alerts from an earlier load are on screen', async () => {
    mocks.listOperationalAlerts.mockResolvedValueOnce(page([alert('a1', 'Earlier alert')])).mockRejectedValue(new Error('refresh failed'));
    render(<OperationsPanel showQuality={false} />);
    expect(await screen.findByText('Earlier alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar alertas' }));
    expect(await screen.findByText('Não foi possível atualizar os alertas. A lista pode estar desatualizada.')).toBeInTheDocument();
    expect(screen.getByText('Earlier alert')).toBeInTheDocument();
  });
});

describe('OperationsPanel request sharing', () => {
  it('shares one set of requests when the events fallback poll starts together with the first load', async () => {
    let release!: (value: unknown) => void;
    mocks.getInventoryQuality.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<OperationsPanel siteId="site-a" />);
    const polled = events.options.fallback?.();
    expect(mocks.getInventoryQuality).toHaveBeenCalledTimes(1);
    expect(mocks.listOperationalAlerts).toHaveBeenCalledTimes(1);
    await act(async () => { release({ score: 90 }); await polled; });
    // After it answered, a later poll is a new request.
    await act(async () => { await events.options.fallback?.(); });
    expect(mocks.getInventoryQuality).toHaveBeenCalledTimes(2);
  });

  it('asks again on an operational event even while an older request is in flight', async () => {
    mocks.getInventoryQuality.mockReturnValueOnce(new Promise(() => undefined));
    render(<OperationsPanel siteId="site-a" />);
    expect(mocks.getInventoryQuality).toHaveBeenCalledTimes(1);
    act(() => { events.options.onEvent?.({ event: 'alert.updated', data: {} }); });
    await waitFor(() => expect(mocks.getInventoryQuality).toHaveBeenCalledTimes(2));
  });

  it('does not reuse a request made for another site', async () => {
    mocks.getInventoryQuality.mockReturnValue(new Promise(() => undefined));
    const { rerender } = render(<OperationsPanel siteId="site-a" />);
    rerender(<OperationsPanel siteId="site-b" />);
    await waitFor(() => expect(mocks.getInventoryQuality).toHaveBeenCalledWith('site-b'));
    expect(mocks.getInventoryQuality).toHaveBeenCalledWith('site-a');
  });
});

describe('OperationsPanel alert actions and notes', () => {
  it('tells the dashboard card that snoozed alerts are elsewhere and links to them', async () => {
    mocks.listOperationalAlerts.mockResolvedValue(page([]));
    render(<OperationsPanel compact showQuality={false} siteId="site-1" />);
    const link = await screen.findByRole('link', { name: 'Ver adiados' });
    expect(link).toHaveAttribute('href', '/alertas?siteId=site-1&status=SNOOZED');
    expect(screen.getByText(/Adiados não aparecem aqui/)).toBeInTheDocument();
  });

  it('asks before resolving and shows the read-only note to viewers', async () => {
    mocks.roles = ['NETWORK_OPERATOR'];
    mocks.listOperationalAlerts.mockResolvedValue(page([{ ...alert('a1', 'Uplink down'), siteId: 'site-1' }]));
    const view = render(<OperationsPanel showQuality={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolver Uplink down' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(mocks.resolveOperationalAlert).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(mocks.resolveOperationalAlert).toHaveBeenCalledWith('a1'));
    view.unmount();

    mocks.roles = [];
    render(<OperationsPanel showQuality={false} />);
    expect(await screen.findByText('Uplink down')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Tens acesso só de leitura');
    expect(screen.queryByRole('button', { name: 'Resolver Uplink down' })).not.toBeInTheDocument();
  });
});
