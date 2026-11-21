import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePlansPage } from './change-plans-page';
import type { CalendarChangePlan, ChangePlan, ImpactPreview } from './api';

const mocks = vi.hoisted(() => ({
  getChangeActivity: vi.fn(async () => [] as unknown[]),
  getChangeSummary: vi.fn(),
  getChangeCalendar: vi.fn(),
  listChangePlans: vi.fn(),
  createChangePlan: vi.fn(),
  getChangeCandidates: vi.fn(),
  getChangePlan: vi.fn(),
  previewChangePlan: vi.fn(),
  getChangeConflicts: vi.fn(),
  startChangePlan: vi.fn(),
  closeChangePlan: vi.fn(),
  tickChecklistItem: vi.fn(),
  addChecklistItems: vi.fn(),
  removeChecklistItem: vi.fn(),
  getPostChangeCheck: vi.fn(),
  getTopologyImpact: vi.fn(),
  detail: null as ChangePlan | null,
}));

vi.mock('./api', () => ({
  cancelChangePlan: vi.fn(), createChangePlan: mocks.createChangePlan, getChangeCandidates: mocks.getChangeCandidates,
  getChangePlan: mocks.getChangePlan, listChangePlans: mocks.listChangePlans, previewChangePlan: mocks.previewChangePlan,
  reviewChangePlan: vi.fn(), submitChangePlan: vi.fn(), updateChangePlan: vi.fn(), getChangeActivity: mocks.getChangeActivity,
  getChangeSummary: mocks.getChangeSummary, getChangeCalendar: mocks.getChangeCalendar,
  getChangeConflicts: mocks.getChangeConflicts, startChangePlan: mocks.startChangePlan, closeChangePlan: mocks.closeChangePlan,
  tickChecklistItem: mocks.tickChecklistItem, addChecklistItems: mocks.addChecklistItems, removeChecklistItem: mocks.removeChecklistItem, getPostChangeCheck: mocks.getPostChangeCheck,
}));
vi.mock('@/features/topology/impact-api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/features/topology/impact-api')>(), getTopologyImpact: mocks.getTopologyImpact }));
vi.mock('@/components/layout/app-shell', async (importOriginal) => ({ ...await importOriginal<typeof import('@/components/layout/app-shell')>(), AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const auth = vi.hoisted(() => ({ roles: null as string[] | null }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => auth.roles === null || auth.roles.includes(role) }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Site One' } }) }));

const emptySummary = { siteId: 'site-1', total: 0, byStatus: { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 }, inProgress: 0, upcoming: 0, generatedAt: '' };
const emptyImpact = { origin: { kind: 'DEVICE', id: 'device-1', name: 'Switch alvo' }, siteId: 'site-1', maxDepth: 12, includeLogical: false, truncated: false, anchorMode: 'explicit', anchorDeviceIds: ['fw'],
  down: [{ id: 'device-1', name: 'Switch alvo', type: 'SWITCH', status: 'ACTIVE', hostname: null, managementIp: null, isCritical: false, criticalityTier: null, rackId: null, reason: 'ORIGIN' }],
  affected: [{ id: 'acc-9', name: 'Access-Leaf-9', type: 'SWITCH', status: 'ACTIVE', hostname: null, managementIp: null, isCritical: false, criticalityTier: null, rackId: null, hops: 1, viaDeviceId: 'device-1', viaConnectionId: 'c1' }],
  powerDegraded: [], hosts: [], applications: [], critical: { T1: [], T2: [], T3: [], untiered: [] }, counts: { down: 1, affected: 1, powerDegraded: 0, hosts: 0, services: 0, applications: 0, tier1: 0 }, hiddenCount: 0, elapsedMs: 3 };
beforeEach(() => {
  mocks.getTopologyImpact.mockResolvedValue(emptyImpact);
  mocks.getChangeSummary.mockResolvedValue(emptySummary);
  mocks.getChangeCalendar.mockResolvedValue({ siteId: 'site-1', from: '', to: '', changePlans: [], maintenanceWindows: [], truncated: false });
  mocks.getChangeConflicts.mockResolvedValue({ changePlanId: '', tierSource: 'IS_CRITICAL', warnings: [], generatedAt: '' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.detail = null; auth.roles = null; });

describe('ChangePlansPage impact preview transition', () => {
  it('renders the list-card title without a decorative site eyebrow and keeps its count badge', async () => {
    mocks.listChangePlans.mockResolvedValue([]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[]], truncated: false });

    render(<ChangePlansPage />);
    const title = await screen.findByRole('heading', { name: 'Alterações Planeadas' });
    const card = title.closest('.change-list-card');

    expect(card).toBeInTheDocument();
    expect(card?.querySelector('.section-kicker')).not.toBeInTheDocument();
    expect(card?.querySelector('.change-count')).toHaveTextContent('0');
  });

  it('creates a draft in a dialog, shows its details, and returns to all alterations', async () => {
    const created: ChangePlan = {
      id: 'new-plan', siteId: 'site-1', title: 'Switch maintenance', reason: 'Replace hardware',
      plannedStartAt: '2026-11-20T10:00:00.000Z', plannedEndAt: '2026-11-20T11:00:00.000Z',
      status: 'DRAFT', revision: 1, previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null,
      items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Replace switch' }],
    };
    mocks.listChangePlans.mockResolvedValue([]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[{ entityType: 'DEVICE', entityId: 'device-1', label: 'Core switch' }]], truncated: false });
    mocks.createChangePlan.mockResolvedValue(created);
    mocks.getChangePlan.mockResolvedValue(created);

    render(<ChangePlansPage />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: /Criar alteração/ }));
    expect(screen.getByRole('dialog', { name: 'Criar alteração' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: created.title } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: created.reason } });
    const starts = within(screen.getByRole('group', { name: 'Início planeado' }));
    fireEvent.change(starts.getByLabelText('Início planeado'), { target: { value: '2026-11-20' } });
    fireEvent.change(starts.getByLabelText('Hora (24 h)'), { target: { value: '10:00' } });
    const ends = within(screen.getByRole('group', { name: 'Fim planeado' }));
    fireEvent.change(ends.getByLabelText('Fim planeado'), { target: { value: '2026-11-20' } });
    fireEvent.change(ends.getByLabelText('Hora (24 h)'), { target: { value: '11:00' } });
    fireEvent.change(screen.getByLabelText('Alvo'), { target: { value: 'device-1' } });
    fireEvent.change(screen.getByLabelText('Operação proposta'), { target: { value: 'Replace switch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar alvo' }));
    expect(screen.getByRole('button', { name: 'Guardar rascunho' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' }));
    expect(mocks.createChangePlan).toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.getChangePlan).toHaveBeenCalledWith('new-plan'));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(await screen.findByRole('heading', { name: 'Switch maintenance' })).toBeInTheDocument();
    expect(document.querySelector('.change-detail .change-section-heading .section-kicker')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Todas as alterações' })).toBeInTheDocument();
    expect(mocks.createChangePlan).toHaveBeenCalledWith(expect.objectContaining({ title: created.title, items: [expect.objectContaining({ entityId: 'device-1' })] }));
    fireEvent.click(screen.getByRole('button', { name: '← Todas as alterações' }));
    expect(await screen.findByRole('heading', { name: 'Alterações Planeadas' })).toBeInTheDocument();
  });

  it('keeps the first calculation pending, then shows its saved timestamp and impacts together despite a stale detail refetch', async () => {
    const plan: ChangePlan = {
      id: 'plan-1', siteId: 'site-1', title: 'Calibration Change', reason: 'Test preview transition',
      plannedStartAt: '2026-11-10T10:00:00.000Z', plannedEndAt: '2026-11-10T11:00:00.000Z',
      status: 'DRAFT', revision: 1, previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null,
      items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Upgrade' }],
    };
    const generatedAt = '2026-11-10T10:39:11.580Z';
    const calculated: ImpactPreview = {
      analysisStatus: 'COMPLETE', revision: 1, generatedAt, knownImpacts: Array.from({ length: 7 }, (_, index) => ({ entityType: 'DEVICE' as const, entityId: `device-${index + 2}`, label: `Affected device ${index + 1}`, href: '/infraestrutura', depth: 1, dependencyPath: ['Connection'], freshness: 'CURRENT' as const, confidence: 'RECORDED' as const })),
      maintenanceOverlaps: [], changeOverlaps: [], coverage: { status: 'COMPLETE', reason: 'Complete', latestInventoryUpdate: null, staleItems: 0, unknownFreshnessItems: 0 }, graphSignature: 'signature',
    };
    mocks.detail = plan;
    mocks.listChangePlans.mockResolvedValue([plan]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[]], truncated: false });
    let detailCalls = 0;
    let resolveStaleDetail!: (value: ChangePlan) => void;
    const staleDetail = new Promise<ChangePlan>((resolve) => { resolveStaleDetail = resolve; });
    mocks.getChangePlan.mockImplementation(async () => {
      detailCalls += 1;
      if (detailCalls === 2) return staleDetail;
      return mocks.detail!;
    });

    let resolvePreview!: (value: ImpactPreview) => void;
    const pendingPreview = new Promise<ImpactPreview>((resolve) => { resolvePreview = resolve; });
    mocks.previewChangePlan.mockImplementation(async () => {
      const result = await pendingPreview;
      mocks.detail = { ...plan, previewRevision: 1, previewSnapshot: result, previewedAt: generatedAt };
      return result;
    });

    render(<ChangePlansPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Calibration Change/ }));
    await vi.waitFor(() => expect(mocks.getChangePlan).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '← Todas as alterações' })).toBeInTheDocument();
    expect(screen.getByText('Pré-visualização').closest('.change-summary-grid')).toHaveTextContent('Por calcular');
    expect(screen.queryByText('Impacto conhecido')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Recalcular pré-visualização' }));

    expect(await screen.findAllByText('A calcular…')).toHaveLength(2);
    expect(screen.queryByText('Impacto conhecido')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('A calcular a pré-visualização…');
    expect(screen.getByText('Pré-visualização').closest('.change-summary-grid')).toHaveTextContent('A calcular…');
    expect(screen.queryByText(/Pré-visualização atualizada/)).not.toBeInTheDocument();
    expect(screen.queryByText('Análise concluída')).not.toBeInTheDocument();

    await act(async () => { resolvePreview(calculated); await pendingPreview; });

    const success = await screen.findByRole('status');
    expect(success).toHaveTextContent('Pré-visualização atualizada');
    const detail = screen.getByText('Pré-visualização').closest('.change-detail');
    const expectedTimestamp = new Date(generatedAt).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
    expect(detail).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    expect(detail).toHaveTextContent('Análise concluída');
    expect(detail?.querySelector('.impact-preview .change-summary-grid div strong')).toHaveTextContent('7');
    expect(detail?.querySelectorAll('.impact-group li')).toHaveLength(7);
    expect(detail).toHaveTextContent('Impacto conhecido');
    expect(detail?.querySelector('.impact-preview .section-kicker')).not.toBeInTheDocument();
    expect(mocks.detail?.previewSnapshot).toBe(calculated);
    expect(screen.getByRole('button', { name: 'Recalcular pré-visualização' })).toBeInTheDocument();
    expect(screen.queryByText('A calcular…')).not.toBeInTheDocument();
    expect(screen.queryByText('Por calcular')).not.toBeInTheDocument();

    await act(async () => { resolveStaleDetail(plan); await staleDetail; });
    expect(detail).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    expect(detail).toHaveTextContent('Affected device 1');

    // A same-revision detail refetch may race persistence of the just-saved
    // preview. Preserve the coherent local snapshot instead of replacing it
    // with a stale detail payload that has no calculated preview yet.
    mocks.detail = plan;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await vi.waitFor(() => {
      expect(mocks.getChangePlan).toHaveBeenCalledTimes(3);
      expect(detail).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    });
    expect(detail).toHaveTextContent('Análise concluída');
    expect(detail?.querySelectorAll('.impact-group li')).toHaveLength(7);
    expect(screen.getByRole('status')).toHaveTextContent('Pré-visualização atualizada');
    expect(screen.getByRole('button', { name: 'Recalcular pré-visualização' })).toBeInTheDocument();

    // Reopening the plan after stale list/detail reads still uses the saved result.
    fireEvent.click(screen.getByRole('button', { name: '← Todas as alterações' }));
    fireEvent.click(await screen.findByRole('button', { name: /Calibration Change/ }));
    // Open + the list reload's detail refresh; a superseded list load no longer refetches the detail.
    await vi.waitFor(() => expect(mocks.getChangePlan).toHaveBeenCalledTimes(5));
    expect(screen.getByText('Pré-visualização').closest('.change-detail')).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    expect(screen.getByText('Pré-visualização').closest('.change-detail')?.querySelectorAll('.impact-group li')).toHaveLength(7);
  });
});

describe('ChangePlansPage workspace', () => {
  const base = (id: string, title: string, start: string, end: string, extra: Partial<ChangePlan> = {}): ChangePlan => ({
    id, siteId: 'site-1', title, reason: 'Motivo', plannedStartAt: start, plannedEndAt: end, status: 'DRAFT', revision: 1,
    previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null, items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Upgrade' }], ...extra,
  });
  const core = base('p1', 'Troca do core', '2026-11-20T10:00:00.000Z', '2026-11-20T12:00:00.000Z', { status: 'SUBMITTED' });
  const vlan = base('p2', 'Renomear VLAN', '2026-11-20T11:00:00.000Z', '2026-11-20T13:00:00.000Z', { items: [{ entityType: 'VLAN', entityId: 'vlan-1', operationSummary: 'Rename' }] });
  const old = base('p3', 'Limpeza antiga', '2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z', { status: 'CANCELLED' });
  const all = [core, vlan, old];
  const candidates = [{ entityType: 'DEVICE' as const, entityId: 'device-1', label: 'Core-SW-01' }];
  const asCalendar = (plan: ChangePlan, others: ChangePlan[]): CalendarChangePlan => ({ id: plan.id, title: plan.title, status: plan.status, plannedStartAt: plan.plannedStartAt, plannedEndAt: plan.plannedEndAt, revision: plan.revision, targetCount: plan.items.length, conflict: false, overlapsWith: others.map((other) => ({ kind: 'CHANGE_PLAN' as const, id: other.id, overlapStartsAt: other.plannedStartAt, overlapEndsAt: plan.plannedEndAt, sharedTargetCount: 0 })) });
  const setup = (path = '/alteracoes') => {
    window.history.replaceState(null, '', path);
    // A small fake of the API: list filters by status and q, candidates by q, calendar by range with server overlaps (core ↔ vlan).
    mocks.listChangePlans.mockImplementation(async (_site: string, filters: { status?: string; q?: string } = {}) => all.filter((plan) => (!filters.status || plan.status === filters.status) && (!filters.q || plan.title.toLowerCase().includes(filters.q.toLowerCase()))));
    mocks.getChangeCandidates.mockImplementation(async (_site: string, filters: { q?: string } = {}) => ({ groups: [candidates.filter((item) => !filters.q || item.label.toLowerCase().includes(filters.q.toLowerCase()))], truncated: false }));
    mocks.getChangeSummary.mockResolvedValue({ ...emptySummary, total: 3, byStatus: { DRAFT: 1, SUBMITTED: 1, APPROVED: 0, REJECTED: 0, CANCELLED: 1 } });
    mocks.getChangeCalendar.mockImplementation(async (_site: string, from: string, to: string) => {
      const inRange = all.filter((plan) => plan.status !== 'CANCELLED' && plan.plannedStartAt < to && plan.plannedEndAt > from);
      return { siteId: 'site-1', from, to, maintenanceWindows: [], truncated: false, changePlans: inRange.map((plan) => asCalendar(plan, inRange.filter((other) => other.id !== plan.id && other.plannedStartAt < plan.plannedEndAt && other.plannedEndAt > plan.plannedStartAt))) };
    });
    mocks.getChangePlan.mockImplementation(async (id: string) => all.find((plan) => plan.id === id)!);
  };
  afterEach(() => { window.history.replaceState(null, '', '/'); });

  it('honours ?q= from the Phase B entity links and searches target labels', async () => {
    setup('/alteracoes?siteId=site-1&q=Troca+do+core');
    render(<ChangePlansPage />);
    expect(await screen.findByRole('button', { name: 'Troca do core' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renomear VLAN' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('1 de 3 alterações')).toBeInTheDocument();

    expect(mocks.listChangePlans).toHaveBeenLastCalledWith('site-1', expect.objectContaining({ q: 'Troca do core' }));

    act(() => { window.history.replaceState(null, '', '/alteracoes?q=core-sw'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await vi.waitFor(() => expect(mocks.getChangeCandidates).toHaveBeenCalledWith('site-1', { q: 'core-sw', type: undefined }));
    // The search named a target: plans touching it are kept (the cancelled one too), the VLAN change is not.
    expect(await screen.findByLabelText('2 de 3 alterações')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Troca do core' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renomear VLAN' })).not.toBeInTheDocument();
  });

  it('flags the overlaps the API reports in the list column', async () => {
    setup();
    render(<ChangePlansPage />);
    await screen.findByRole('button', { name: 'Troca do core' });
    await vi.waitFor(() => expect(screen.getAllByText('1 sobreposição')).toHaveLength(2));
    expect(mocks.getChangeCalendar).toHaveBeenCalledWith('site-1', core.plannedStartAt, vlan.plannedEndAt);
  });

  it('filters by status tab with counts and keeps the tab in the URL', async () => {
    setup();
    render(<ChangePlansPage />);
    await screen.findByRole('button', { name: 'Troca do core' });
    expect(screen.getByRole('button', { name: 'Todas (3)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Canceladas (1)' }));
    expect(window.location.search).toContain('status=CANCELLED');
    expect(await screen.findByRole('button', { name: 'Limpeza antiga' })).toBeInTheDocument();
    expect(mocks.listChangePlans).toHaveBeenLastCalledWith('site-1', expect.objectContaining({ status: 'CANCELLED' }));
    expect(screen.queryByRole('button', { name: 'Troca do core' })).not.toBeInTheDocument();
  });

  it('flags overlapping windows in the list and in the calendar', async () => {
    setup('/alteracoes?view=calendar&month=2026-11');
    render(<ChangePlansPage />);
    const calendar = await screen.findByRole('region', { name: 'Calendário de alterações' });
    await vi.waitFor(() => expect(calendar.querySelectorAll('.state-badge.excluded')).toHaveLength(2));
    expect(screen.getByText('2 alterações com janelas sobrepostas neste mês.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(window.location.search).toContain('month=2026-10');
    expect(await screen.findByText('Sem janelas sobrepostas neste mês.')).toBeInTheDocument();
  });

  it('opens ?changeId= directly, lists the overlap and the activity, and returns to the list', async () => {
    setup('/alteracoes?changeId=p1');
    render(<ChangePlansPage />);
    expect(await screen.findByRole('heading', { name: 'Troca do core' })).toBeInTheDocument();
    expect(mocks.getChangeActivity).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('A janela sobrepõe-se a outras alterações ou manutenções deste Site')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Renomear VLAN' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Core-SW-01' })).toHaveAttribute('href', '/infraestrutura/equipamentos/device-1?siteId=site-1');
    expect(await screen.findByRole('heading', { name: 'Atividade' })).toBeInTheDocument();
    expect(screen.getByText('Ainda não há atividade registada para esta alteração.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Todas as alterações' }));
    expect(window.location.search).not.toContain('changeId');
    expect(await screen.findByRole('heading', { name: 'Alterações Planeadas' })).toBeInTheDocument();
  });

  it('shows what goes down if the target device goes down in the plan detail (Step 34)', async () => {
    setup('/alteracoes?changeId=p1');
    render(<ChangePlansPage />);
    const section = await screen.findByTestId('plan-impact');
    expect(within(section).getByRole('heading', { name: 'Impacto se o equipamento for abaixo' })).toBeInTheDocument();
    expect(await within(section).findByRole('link', { name: 'Access-Leaf-9' })).toBeInTheDocument();
    expect(mocks.getTopologyImpact).toHaveBeenCalledWith({ kind: 'DEVICE', id: 'device-1' }, { includeLogical: false });
    fireEvent.click(within(section).getByRole('button', { name: 'Ocultar impacto' }));
    expect(within(section).queryByRole('link', { name: 'Access-Leaf-9' })).not.toBeInTheDocument();
  });

  it('hides the impact section for plans without a device target', async () => {
    setup('/alteracoes?changeId=p2');
    render(<ChangePlansPage />);
    expect(await screen.findByRole('heading', { name: 'Renomear VLAN' })).toBeInTheDocument();
    expect(screen.queryByTestId('plan-impact')).not.toBeInTheDocument();
  });

  it('shows the activity log from the API', async () => {
    setup('/alteracoes?changeId=p1');
    mocks.getChangeActivity.mockResolvedValueOnce([{ id: 'a1', action: 'CHANGE_PLAN_UPDATED', at: '2026-11-19T09:00:00.000Z', actor: { username: 'ana', displayName: 'Ana Ops' }, revision: 2 }] as never);
    render(<ChangePlansPage />);
    expect(await screen.findByText('Rascunho editado')).toBeInTheDocument();
    expect(screen.getByText(/Ana Ops/)).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar a atividade desta alteração.')).not.toBeInTheDocument();
  });

  it('searches targets in the editor with candidates?q=&type=', async () => {
    setup();
    render(<ChangePlansPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Criar alteração/ }));
    fireEvent.change(screen.getByLabelText('Pesquisar alvo'), { target: { value: 'core' } });
    await vi.waitFor(() => expect(mocks.getChangeCandidates).toHaveBeenCalledWith('site-1', { q: 'core', type: 'DEVICE' }));
    expect(await screen.findByRole('option', { name: 'Core-SW-01' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pesquisar alvo'), { target: { value: 'nada' } });
    expect(await screen.findByText('Nenhum alvo deste tipo corresponde à pesquisa.')).toBeInTheDocument();
  });

  it('asks for confirmation before cancelling a change', async () => {
    setup('/alteracoes?changeId=p1');
    const cancelSpy = vi.mocked((await import('./api')).cancelChangePlan);
    render(<ChangePlansPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar alteração' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancelar alteração' });
    expect(dialog).toHaveTextContent('Cancelar “Troca do core”?');
    fireEvent.click(screen.getByRole('button', { name: 'Manter' }));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});

describe('ChangePlansPage implementation and close-out (Step 30)', () => {
  const plan = (extra: Partial<ChangePlan> = {}): ChangePlan => ({
    id: 'run-1', siteId: 'site-1', title: 'Firmware core', reason: 'Segurança', plannedStartAt: '2026-11-22T22:00:00.000Z', plannedEndAt: '2026-11-22T23:00:00.000Z',
    status: 'APPROVED', revision: 3, previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null,
    items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Atualizar firmware', proposedValue: { firmware: '9.4.2' } }], checklist: [], ...extra,
  });
  const setup = (current: ChangePlan) => {
    window.history.replaceState(null, '', `/alteracoes?changeId=${current.id}`);
    mocks.listChangePlans.mockResolvedValue([current]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[{ entityType: 'DEVICE', entityId: 'device-1', label: 'Core-SW-01' }]], truncated: false });
    mocks.getChangePlan.mockImplementation(async () => mocks.detail ?? current);
  };
  afterEach(() => { window.history.replaceState(null, '', '/'); });

  it('shows non-blocking conflict warnings and starts an approved plan after confirmation', async () => {
    const approved = plan();
    setup(approved);
    mocks.getChangeConflicts.mockResolvedValue({ changePlanId: 'run-1', tierSource: 'IS_CRITICAL', generatedAt: '', warnings: [
      { code: 'OUTSIDE_MAINTENANCE_WINDOW', message: '', maintenanceWindowCount: 0, uncovered: [] },
      { code: 'CRITICAL_ASSET', message: '', devices: [{ id: 'device-1', name: 'Core-SW-01' }] },
    ] });
    const started = plan({ status: 'IN_PROGRESS', startedAt: '2026-11-22T22:01:00.000Z', startedBy: { username: 'ana', displayName: 'Ana Ops' } });
    mocks.startChangePlan.mockImplementation(async () => { mocks.detail = started; return { plan: started, warnings: [{ code: 'CRITICAL_ASSET', message: '', devices: [] }] }; });
    render(<ChangePlansPage />);
    const warnings = await screen.findByLabelText('Avisos de conflito');
    expect(warnings).toHaveTextContent('Fora das janelas de manutenção do Site');
    expect(warnings).toHaveTextContent('Afeta ativos críticos');
    expect(warnings).toHaveTextContent('Não bloqueiam a alteração.');

    fireEvent.click(screen.getByRole('button', { name: 'Iniciar implementação' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Iniciar implementação' });
    expect(dialog).toHaveTextContent('2 avisos de conflito');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Iniciar implementação' }));
    await vi.waitFor(() => expect(mocks.startChangePlan).toHaveBeenCalledWith('run-1', 3));
    expect(await screen.findByText(/Implementação iniciada com 1 aviso/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Encerrar alteração' })).toBeInTheDocument();
    expect(screen.getByText(/Ana Ops/)).toBeInTheDocument();
  });

  it('gives an auditor a read-only execution panel: no start, no ticks, no close-out', async () => {
    auth.roles = ['AUDITOR'];
    const step = { id: 'step-1', position: 1, label: 'Guardar configuração', doneAt: null, doneBy: null };
    setup(plan({ checklist: [step] }));
    const { unmount } = render(<ChangePlansPage />);
    expect(await screen.findByRole('checkbox', { name: /Guardar configuração/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Iniciar implementação' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Novos passos (um por linha)')).not.toBeInTheDocument();
    unmount();

    setup(plan({ status: 'IN_PROGRESS', startedAt: '2026-11-22T22:01:00.000Z', checklist: [step] }));
    render(<ChangePlansPage />);
    expect(await screen.findByRole('checkbox', { name: /Guardar configuração/ })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Encerrar alteração' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar alteração' })).not.toBeInTheDocument();
    expect(mocks.startChangePlan).not.toHaveBeenCalled();
    expect(mocks.tickChecklistItem).not.toHaveBeenCalled();
  });

  it('ticks checklist steps only while in progress and records who ticked them', async () => {
    const step = { id: 'step-1', position: 1, label: 'Guardar configuração', doneAt: null, doneBy: null };
    setup(plan({ status: 'IN_PROGRESS', checklist: [step] }));
    mocks.tickChecklistItem.mockResolvedValue({ ...step, doneAt: '2026-11-22T22:10:00.000Z', doneBy: { username: 'rui', displayName: 'Rui' } });
    render(<ChangePlansPage />);
    const checkbox = await screen.findByRole('checkbox', { name: /Guardar configuração/ });
    expect(screen.getByLabelText('0 de 1 passos concluídos')).toBeInTheDocument();
    fireEvent.click(checkbox);
    await vi.waitFor(() => expect(mocks.tickChecklistItem).toHaveBeenCalledWith('run-1', 'step-1', true));
    expect(await screen.findByText(/Concluído por Rui/)).toBeInTheDocument();
    expect(screen.getByLabelText('1 de 1 passos concluídos')).toBeInTheDocument();
  });

  it('keeps checklist ticks disabled before the plan starts but lets steps be added', async () => {
    setup(plan({ checklist: [{ id: 'step-1', position: 1, label: 'Guardar configuração', doneAt: null }] }));
    mocks.addChecklistItems.mockResolvedValue([{ id: 'step-1', position: 1, label: 'Guardar configuração', doneAt: null }, { id: 'step-2', position: 2, label: 'Reiniciar', doneAt: null }]);
    render(<ChangePlansPage />);
    expect(await screen.findByRole('checkbox', { name: /Guardar configuração/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Novos passos (um por linha)'), { target: { value: 'Reiniciar\n\nreiniciar\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar passos' }));
    await vi.waitFor(() => expect(mocks.addChecklistItems).toHaveBeenCalledWith('run-1', ['Reiniciar']));
    expect(await screen.findByRole('checkbox', { name: /Reiniciar/ })).toBeInTheDocument();
  });

  it('requires a closing note for a failed change and shows the post-change check', async () => {
    setup(plan({ status: 'IN_PROGRESS', startedAt: '2026-11-22T22:01:00.000Z' }));
    const closed = plan({ status: 'FAILED', startedAt: '2026-11-22T22:01:00.000Z', closedAt: '2026-11-22T22:40:00.000Z', closingNote: 'Firmware recusado' });
    const check = { result: 'DIFFERENT', counts: { AS_PLANNED: 0, DIFFERENT: 1, NOT_COMPARABLE: 0, TARGET_MISSING: 0 }, hiddenItemCount: 0, checkedAt: '2026-11-22T22:40:00.000Z',
      items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Atualizar firmware', result: 'DIFFERENT', fields: [{ field: 'firmware', planned: '9.4.2', current: '9.3.7', before: '9.3.7', matches: false }] }] };
    mocks.closeChangePlan.mockImplementation(async () => { mocks.detail = closed; return { plan: closed, postChangeCheck: check }; });
    mocks.getPostChangeCheck.mockResolvedValue(check);
    render(<ChangePlansPage />);
    fireEvent.change(await screen.findByLabelText('Resultado'), { target: { value: 'FAILED' } });
    const closeButton = screen.getByRole('button', { name: 'Encerrar alteração' });
    expect(closeButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Nota de encerramento/), { target: { value: 'Firmware recusado' } });
    expect(closeButton).not.toBeDisabled();
    fireEvent.click(closeButton);
    const dialog = await screen.findByRole('alertdialog', { name: 'Encerrar alteração' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Encerrar alteração' }));
    await vi.waitFor(() => expect(mocks.closeChangePlan).toHaveBeenCalledWith('run-1', 'FAILED', 'Firmware recusado'));
    expect(await screen.findByText(/Verificação pós-alteração: Diferente/)).toBeInTheDocument();
    const checkSection = (await screen.findByRole('heading', { name: 'Verificação pós-alteração' })).closest('section')!;
    expect(checkSection).toHaveTextContent('firmware');
    expect(checkSection).toHaveTextContent('9.4.2');
    expect(checkSection.querySelector('.change-check-mismatch')).toBeInTheDocument();
    expect(screen.getByText('Firmware recusado')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Encerrar alteração' })).not.toBeInTheDocument();
  });

  it('shows the calendar legend with the new states and asks for cancelled plans only on the Canceladas tab', async () => {
    window.history.replaceState(null, '', '/alteracoes?view=calendar&month=2026-11&status=CANCELLED');
    mocks.listChangePlans.mockResolvedValue([]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[]], truncated: false });
    render(<ChangePlansPage />);
    const legend = await screen.findByRole('list', { name: 'Legenda do calendário' });
    for (const label of ['Em curso', 'Concluída', 'Falhou', 'Revertida', 'Cancelada']) expect(legend).toHaveTextContent(label);
    await vi.waitFor(() => expect(mocks.getChangeCalendar).toHaveBeenCalledWith('site-1', expect.any(String), expect.any(String), true));
    expect(screen.getByRole('button', { name: /Falhadas/ })).toBeInTheDocument();
  });
});
