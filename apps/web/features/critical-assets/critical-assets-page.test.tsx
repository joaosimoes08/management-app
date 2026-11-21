import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import { CriticalAssetsPage } from './critical-assets-page';
import { BulkConfirmDialog } from './critical-assets-dialogs';
import { translateLegacyText } from '@/lib/i18n/legacy-messages';
import { buildRows, countRows, emptyFilters, filterRows, NO_OWNER, withRecordedAttestation, type CriticalAssetsResult } from './workbench';

vi.mock('@/components/layout/app-shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/app-shell')>(),
  AppShell: ({ children, actions, search }: { children: React.ReactNode; actions?: React.ReactNode; search?: { value: string; onChange: (value: string) => void; placeholder: string } }) => <>
    <div data-testid="toolbar-actions">{actions}</div>
    {search && <input aria-label="Pesquisa da página" placeholder={search.placeholder} value={search.value} onChange={(event) => search.onChange(event.target.value)} />}
    {children}
  </>,
}));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
const roles = vi.hoisted(() => ({ current: ['ADMIN'] as string[] }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => roles.current.includes(role) }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

const network = { id: 'group-1', name: 'Network Team' };
const systems = { id: 'group-2', name: 'Systems Team' };
const attestation = (id: string, weekStart: string, extra: Record<string, unknown> = {}) => ({ id, weekStart, outcome: null as string | null, notes: null as string | null, confirmedAt: null as string | null, confirmedBy: null as string | null, confirmedByName: null as string | null, ...extra });
const asset = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, type: 'SWITCH', hostname: `${name.toLowerCase().replace(/\s/g, '-')}`, managementIp: '192.0.2.1', serialNumber: `SN-${id}`, assetTag: `AT-${id}`, status: 'ACTIVE', owner: network, assignedGroup: network, dueState: 'up_to_date', dueDate: '2026-11-23T09:00:00.000Z', dueWeekStart: '2026-11-16', pendingCount: 0, overdueCount: 0, latestOutcome: null as string | null, latestConfirmedAt: null as string | null, attestations: [] as ReturnType<typeof attestation>[], ...extra });

const history = [
  attestation('a-core-5', '2026-11-16T00:00:00.000Z'),
  attestation('a-core-4', '2026-11-09T00:00:00.000Z', { outcome: 'CORRECTION_NEEDED', notes: 'Serial number is wrong', confirmedAt: '2026-11-10T10:00:00.000Z', confirmedBy: 'u-1', confirmedByName: 'Ana Reviewer' }),
  attestation('a-core-3', '2026-11-02T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-03T10:00:00.000Z', confirmedBy: 'u-2', confirmedByName: 'Bruno' }),
  attestation('a-core-2', '2026-10-26T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-10-27T10:00:00.000Z', confirmedByName: 'Bruno' }),
  attestation('a-core-1', '2026-10-19T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-10-20T10:00:00.000Z', confirmedByName: 'Bruno' }),
];

const pageData = (): CriticalAssetsResult => {
  const core = asset('device-1', 'Core switch', { dueState: 'overdue', pendingCount: 1, overdueCount: 1, dueDate: '2026-11-23T09:00:00.000Z', latestOutcome: 'CORRECTION_NEEDED', latestConfirmedAt: '2026-11-10T10:00:00.000Z', attestations: history });
  const edge = asset('device-2', 'Edge router', { type: 'ROUTER', owner: systems, assignedGroup: systems, dueState: 'due_this_week', pendingCount: 1, latestOutcome: 'CONFIRMED', latestConfirmedAt: '2026-11-10T10:00:00.000Z', attestations: [attestation('a-edge-2', '2026-11-16T00:00:00.000Z'), attestation('a-edge-1', '2026-11-09T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-10T10:00:00.000Z', confirmedByName: 'Carla' })] });
  const storage = asset('device-3', 'Backup array', { type: 'STORAGE', owner: systems, assignedGroup: systems, dueState: 'up_to_date', latestOutcome: 'CONFIRMED', latestConfirmedAt: '2026-11-17T10:00:00.000Z', attestations: [attestation('a-st-1', '2026-11-16T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-17T10:00:00.000Z', confirmedByName: 'Carla' })] });
  // No owner: the API always reports 'unscheduled' with no due date, but keeps the pending counts.
  const firewall = asset('device-4', 'Perimeter firewall', { type: 'FIREWALL', owner: null, assignedGroup: null, dueState: 'unscheduled', dueDate: null, dueWeekStart: null, pendingCount: 2, overdueCount: 1 });
  return {
    timezone: 'Europe/Lisbon',
    mappings: [{ id: 'm-1', assetType: 'SWITCH', group: network }, { id: 'm-2', assetType: 'ROUTER', group: systems }, { id: 'm-3', assetType: 'STORAGE', group: systems }],
    // Admins receive every asset in `assets` and the unowned ones again in `unassigned`.
    assets: [core, edge, storage, firewall],
    unassigned: [firewall],
  } as unknown as CriticalAssetsResult;
};

const savedReview = (id: string, outcome: string, notes: string | null = null) => ({ id, siteId: 'site-1', weekStart: '2026-11-16T00:00:00.000Z', outcome, notes, confirmedAt: '2026-11-20T10:00:00.000Z', confirmedBy: 'u-9', confirmedByName: 'Joao', inventoryChanged: false });
const alreadyRecorded = () => new ApiRequestError('A revisão da semana de 2026-11-16 já foi registada por Ana.', 409, { code: 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED', message: 'A revisão da semana de 2026-11-16 já foi registada por Ana.', details: { weekStart: '2026-11-16', confirmedByName: 'Ana' } });

let data = pageData();
const renderPage = (queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => ({ ...render(<QueryClientProvider client={queryClient}><CriticalAssetsPage /></QueryClientProvider>), queryClient });
const table = async () => within(await screen.findByRole('region', { name: 'Ativos críticos' }));
const rowFor = async (name: string) => (await screen.findByRole('button', { name: `Abrir histórico de ${name}` })).closest('tr') as HTMLElement;
const visibleNames = () => [...document.querySelectorAll('.critical-assets-table tbody .link-button')].map((item) => item.textContent);

afterEach(cleanup);
beforeEach(() => {
  roles.current = ['ADMIN'];
  data = pageData();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/settings/access-groups')) return [network, systems] as never;
    if (url.endsWith('/confirm')) {
      const id = url.split('/').at(-2) as string;
      const body = JSON.parse(String(init?.body)) as { outcome: string; notes?: string };
      const saved = savedReview(id, body.outcome, body.notes ?? null);
      // Behave like the server: later refetches include the recorded review.
      data = withRecordedAttestation(data, saved) as CriticalAssetsResult;
      return saved as never;
    }
    if (url.includes('/critical-assets/mapping')) return { id: 'm-new' } as never;
    return data as never;
  });
});

describe('critical assets workbench helpers', () => {
  it('merges admin rows once, sorts overdue first and counts the strip', () => {
    const rows = buildRows(pageData());
    expect(rows.map((row) => row.name)).toEqual(['Core switch', 'Edge router', 'Perimeter firewall', 'Backup array']);
    expect(countRows(rows)).toEqual({ overdue: 1, dueThisWeek: 1, needsCorrection: 1, noOwner: 1 });
    expect(rows.find((row) => row.name === 'Perimeter firewall')).toMatchObject({ dueState: 'unscheduled', dueDate: null, pendingCount: 2 });
    expect(filterRows(rows, '', { ...emptyFilters, owner: NO_OWNER }).map((row) => row.name)).toEqual(['Perimeter firewall']);
    expect(filterRows(rows, 'SN-device-2', emptyFilters).map((row) => row.name)).toEqual(['Edge router']);
  });

  it('derives due state and latest outcome when an older API omits them', () => {
    const legacy = { timezone: 'Europe/Lisbon', mappings: [{ id: 'm', assetType: 'SWITCH', group: network }], unassigned: [], assets: [{ id: 'd', name: 'Old', type: 'SWITCH', status: 'ACTIVE', attestations: [{ id: 'x', weekStart: '2026-11-16T00:00:00.000Z' }, { id: 'y', weekStart: '2026-11-09T00:00:00.000Z', outcome: 'CONFIRMED', confirmedAt: '2026-11-10T00:00:00.000Z' }] }] } as CriticalAssetsResult;
    expect(buildRows(legacy)[0]).toMatchObject({ owner: network, dueState: 'due_this_week', pendingCount: 1, latestOutcome: 'CONFIRMED' });
    legacy.mappings = [];
    expect(buildRows(legacy)[0]).toMatchObject({ owner: null, dueState: 'unscheduled', pendingCount: 1 });
  });
});

describe('CriticalAssetsPage', () => {
  it('shows a dense table with group, latest result, due state as text and an explicit no-owner label', async () => {
    renderPage();
    const core = await rowFor('Core switch');
    expect(within(core).getByText('Network Team')).toBeInTheDocument();
    expect(within(core).getByText('Correção pedida')).toHaveClass('state-badge');
    expect(within(core).getByText(/Ana Reviewer/)).toBeInTheDocument();
    expect(within(core).getByText('Em atraso')).toBeInTheDocument();
    const firewall = await rowFor('Perimeter firewall');
    expect(within(firewall).getByText('Sem responsável')).toBeInTheDocument();
    expect(within(firewall).getByText('Sem agendamento')).toBeInTheDocument();
    expect(within(firewall).getByText('Sem revisão')).toBeInTheDocument();
    expect(within(firewall).getByText('2 pendentes, sem responsável')).toBeInTheDocument();
    expect(document.querySelectorAll('.critical-assets-table tbody tr')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: '4 ativos críticos' })).toBeInTheDocument();
    expect(document.querySelector('.asset-grid')).not.toBeInTheDocument();
  });

  it('filters from the count strip and restores the full list when toggled off', async () => {
    renderPage();
    await rowFor('Core switch');
    const strip = screen.getByRole('group', { name: 'Resumo e filtros rápidos' });
    const overdue = within(strip).getByRole('button', { name: /Em atraso/ });
    expect(overdue).toHaveTextContent('1');
    fireEvent.click(overdue);
    expect(overdue).toHaveAttribute('aria-pressed', 'true');
    expect(visibleNames()).toEqual(['Core switch']);
    fireEvent.click(within(strip).getByRole('button', { name: /Sem responsável/ }));
    expect(visibleNames()).toEqual([]);
    expect(screen.getByText('Sem ativos correspondentes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Limpar filtros/ }));
    expect(visibleNames()).toHaveLength(4);
    fireEvent.click(within(strip).getByRole('button', { name: /Correção pedida/ }));
    expect(visibleNames()).toEqual(['Core switch']);
    fireEvent.click(within(strip).getByRole('button', { name: /Correção pedida/ }));
    expect(visibleNames()).toHaveLength(4);
  });

  it('keeps unowned assets out of the overdue count and under "no owner" and "unscheduled"', async () => {
    renderPage();
    await rowFor('Core switch');
    const strip = screen.getByRole('group', { name: 'Resumo e filtros rápidos' });
    expect(within(strip).getByRole('button', { name: /Em atraso/ })).toHaveTextContent('1');
    fireEvent.click(within(strip).getByRole('button', { name: /Em atraso/ }));
    expect(visibleNames()).toEqual(['Core switch']);
    fireEvent.click(within(strip).getByRole('button', { name: /Em atraso/ }));
    fireEvent.change(screen.getByLabelText('Filtrar por prazo'), { target: { value: 'unscheduled' } });
    expect(visibleNames()).toEqual(['Perimeter firewall']);
    fireEvent.click(screen.getByRole('button', { name: /Limpar filtros/ }));
    fireEvent.click(within(strip).getByRole('button', { name: /Sem responsável/ }));
    expect(visibleNames()).toEqual(['Perimeter firewall']);
  });

  it('searches by hostname, IP, serial or tag and combines the toolbar filters', async () => {
    renderPage();
    await rowFor('Core switch');
    fireEvent.change(screen.getByLabelText('Pesquisa da página'), { target: { value: 'AT-device-3' } });
    expect(visibleNames()).toEqual(['Backup array']);
    expect(screen.getByRole('heading', { name: '1 de 4 ativos' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pesquisa da página'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filtrar por grupo responsável'), { target: { value: 'group-2' } });
    expect(visibleNames()).toEqual(['Edge router', 'Backup array']);
    fireEvent.change(screen.getByLabelText('Filtrar por prazo'), { target: { value: 'due_this_week' } });
    expect(visibleNames()).toEqual(['Edge router']);
    fireEvent.change(screen.getByLabelText('Filtrar por tipo'), { target: { value: 'STORAGE' } });
    expect(visibleNames()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Limpar filtros/ }));
    expect(visibleNames()).toHaveLength(4);
    expect(screen.getByLabelText('Filtrar por tipo')).toHaveValue('');
  });

  it('opens the side panel with the full history, reviewer names and notes, and closes with Escape', async () => {
    renderPage();
    const opener = await screen.findByRole('button', { name: 'Abrir histórico de Core switch' });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole('complementary', { name: 'Histórico de Core switch' });
    expect(within(panel).getByRole('heading', { name: 'Histórico de revisões (5)' })).toBeInTheDocument();
    expect(panel.querySelectorAll('.host-relation')).toHaveLength(5);
    expect(within(panel).getByText(/Serial number is wrong/)).toBeInTheDocument();
    expect(within(panel).getByText(/Ana Reviewer/)).toBeInTheDocument();
    expect(within(panel).getAllByText(/Bruno/)).toHaveLength(3);
    expect(within(panel).getByRole('button', { name: 'Fechar' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Histórico de Core switch' })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('records a correction through the notes dialog instead of window.prompt, and the note reaches the history', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    renderPage();
    fireEvent.click(within(await rowFor('Core switch')).getByRole('button', { name: 'Pedir correção de Core switch' }));
    const dialog = screen.getByRole('dialog', { name: 'Rever Core switch' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registar pedido de correção' }));
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/confirm'), expect.anything());
    fireEvent.change(within(dialog).getByLabelText('Dados a corrigir (obrigatório)'), { target: { value: 'Tag AT-1 is now AT-9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registar pedido de correção' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/critical-assets/a-core-5/confirm', expect.objectContaining({ method: 'POST', body: JSON.stringify({ outcome: 'CORRECTION_NEEDED', notes: 'Tag AT-1 is now AT-9' }) })));
    expect(await screen.findByText('Core switch: pedido de correção registado.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir histórico de Core switch' }));
    expect(within(screen.getByRole('complementary')).getByText(/Tag AT-1 is now AT-9/)).toBeInTheDocument();
  });

  it('confirms with notes from the side panel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir histórico de Edge router' }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Confirmar' }));
    const dialog = screen.getByRole('dialog', { name: 'Rever Edge router' });
    expect(within(dialog).getByRole('radio', { name: 'Dados corretos' })).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText('Notas (opcional)'), { target: { value: 'Checked on site' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registar confirmação' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/critical-assets/a-edge-2/confirm', expect.objectContaining({ body: JSON.stringify({ outcome: 'CONFIRMED', notes: 'Checked on site' }) })));
    expect(await within(screen.getByRole('complementary')).findByText(/Checked on site/)).toBeInTheDocument();
  });

  it('reports a repeat review (409) as already recorded without crashing', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.endsWith('/confirm')) throw alreadyRecorded();
      if (url.includes('/settings/access-groups')) return [network, systems] as never;
      return data as never;
    });
    renderPage();
    fireEvent.click(within(await rowFor('Edge router')).getByRole('button', { name: 'Confirmar revisão de Edge router' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('já foi registada por Ana');
    expect(screen.getByRole('button', { name: 'Abrir histórico de Edge router' })).toBeInTheDocument();
  });

  it('bulk confirms only the current cycle of each selected asset, asks first and reports each item', async () => {
    // Core switch also has an older overdue week: bulk must leave it for an individual review.
    const core = data.assets[0];
    core.attestations = [...core.attestations, attestation('a-core-old', '2026-10-12T00:00:00.000Z')];
    core.pendingCount = 2;
    const posted: string[] = [];
    let calls = 0;
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('/settings/access-groups')) return [network, systems] as never;
      if (url.endsWith('/confirm')) {
        calls += 1;
        posted.push(url);
        if (url.includes('a-core-5')) throw alreadyRecorded();
        return savedReview('a-edge-2', 'CONFIRMED') as never;
      }
      return data as never;
    });
    renderPage();
    const actions = screen.getByTestId('toolbar-actions');
    const bulk = within(actions).getByRole('button', { name: /Confirmar selecionados \(0\)/ });
    expect(bulk).toBeDisabled();
    expect(within(await rowFor('Backup array')).getByRole('checkbox')).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos os ativos com revisão pendente' }));
    expect(within(actions).getByRole('button', { name: /Confirmar selecionados \(2\)/ })).toBeEnabled();
    fireEvent.click(within(actions).getByRole('button', { name: /Confirmar selecionados \(2\)/ }));
    const dialog = screen.getByRole('dialog', { name: 'Confirmar selecionados' });
    expect(within(dialog).getByText(/2 ativos selecionados · 2 revisões da semana atual/)).toBeInTheDocument();
    expect(within(dialog).getByRole('note')).toHaveTextContent('1 ativo tem semanas anteriores por rever. Revê-as individualmente no histórico.');
    expect(calls).toBe(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar 2 revisões' }));
    expect(await within(dialog).findByText('1 de 2 registadas.')).toBeInTheDocument();
    expect(calls).toBe(2);
    expect(posted).toEqual(['/api/v1/critical-assets/a-core-5/confirm', '/api/v1/critical-assets/a-edge-2/confirm']);
    const results = within(within(dialog).getByRole('region', { name: 'Revisões a confirmar' }));
    expect(results.getByText('Já registado').closest('tr')).toHaveTextContent('Core switch');
    expect(results.getByText('Registado').closest('tr')).toHaveTextContent('Edge router');
    fireEvent.click(within(dialog.querySelector('.modal-actions') as HTMLElement).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the singular for one asset with earlier weeks and the plural otherwise, in pt-PT and English', () => {
    const dialog = (olderCount: number) => render(<BulkConfirmDialog selectedCount={2} olderCount={olderCount} items={[]} results={null} running={false} formatDate={(value) => value ?? ''} close={() => undefined} run={() => undefined} />);
    const one = dialog(1);
    expect(screen.getByRole('note')).toHaveTextContent('1 ativo tem semanas anteriores por rever. Revê-as individualmente no histórico.');
    one.unmount();
    dialog(3);
    expect(screen.getByRole('note')).toHaveTextContent('3 ativos têm semanas anteriores por rever. Revê-as individualmente no histórico.');
    expect(translateLegacyText('en-US', '1 ativo tem semanas anteriores por rever. Revê-as individualmente no histórico.')).toBe('1 asset has earlier weeks to review. Review them individually in the history.');
    expect(translateLegacyText('en-US', '3 ativos têm semanas anteriores por rever. Revê-as individualmente no histórico.')).toBe('3 assets have earlier weeks to review. Review them individually in the history.');
  });

  it('reports a failed bulk item without stopping the others', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('/settings/access-groups')) return [network, systems] as never;
      if (url.includes('a-core-5/confirm')) throw new ApiRequestError('Não tens acesso a esta revisão', 403, { message: 'Não tens acesso a esta revisão' });
      if (url.endsWith('/confirm')) return savedReview('a-edge-2', 'CONFIRMED') as never;
      return data as never;
    });
    renderPage();
    fireEvent.click(within(await rowFor('Core switch')).getByRole('checkbox', { name: 'Selecionar ativo Core switch' }));
    fireEvent.click(within(await rowFor('Edge router')).getByRole('checkbox', { name: 'Selecionar ativo Edge router' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar selecionados \(2\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar 2 revisões' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirmar selecionados' });
    expect(await within(dialog).findByText('1 de 2 registadas.')).toBeInTheDocument();
    expect(within(dialog).getByText('Falha ao registar').closest('tr')).toHaveTextContent('Não tens acesso a esta revisão');
  });

  it('assigns an owner from a visible button on the unowned row (no overflow menu)', async () => {
    renderPage();
    expect(document.querySelector('details.context-toolbar-more')).not.toBeInTheDocument();
    fireEvent.click(within(await rowFor('Perimeter firewall')).getByRole('button', { name: 'Atribuir responsável a Perimeter firewall' }));
    const dialog = screen.getByRole('dialog', { name: 'Atribuir responsável' });
    expect(within(dialog).getByLabelText('Tipo de ativo')).toHaveValue('FIREWALL');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Systems Team' })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText('Grupo responsável'), { target: { value: 'group-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar responsável' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/critical-assets/mapping?siteId=site-1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ assetType: 'FIREWALL', groupId: 'group-2', timezone: 'Europe/Lisbon' }) })));
    expect(await screen.findByText('Responsável por FIREWALL guardado.')).toBeInTheDocument();
    expect(within(screen.getByTestId('toolbar-actions')).getByRole('button', { name: /Responsáveis/ })).toBeInTheDocument();
  });

  it('hides review and owner actions from read-only users', async () => {
    roles.current = ['VIEWER'];
    renderPage();
    const core = await rowFor('Core switch');
    expect(within(core).queryByRole('button', { name: /Confirmar revisão/ })).not.toBeInTheDocument();
    expect(within(core).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Atribuir responsável/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar selecionados/ })).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/settings/access-groups'));
  });

  it('keeps every table row reachable through keyboard-focusable controls', async () => {
    renderPage();
    const region = (await table()).getByRole('table').closest('[role="region"]');
    expect(region).toHaveAttribute('tabindex', '0');
    const core = await rowFor('Core switch');
    for (const control of within(core).getAllByRole('button')) expect(control.tagName).toBe('BUTTON');
  });

  it('hydrates server markup without a mismatch', async () => {
    const markup = renderToString(<QueryClientProvider client={new QueryClient()}><CriticalAssetsPage /></QueryClientProvider>);
    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['critical-assets', 'site-1'], data);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, <QueryClientProvider client={client}><CriticalAssetsPage /></QueryClientProvider>); });
      await waitFor(() => expect(container.querySelectorAll('.critical-assets-table tbody tr')).toHaveLength(4));
      expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Hydration failed');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
      consoleError.mockRestore();
    }
  });
});
