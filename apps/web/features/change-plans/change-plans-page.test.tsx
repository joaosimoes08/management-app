import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePlansPage } from './change-plans-page';
import type { ChangePlan, ImpactPreview } from './api';

const mocks = vi.hoisted(() => ({
  getChangeActivity: vi.fn(async () => null),
  listChangePlans: vi.fn(),
  createChangePlan: vi.fn(),
  getChangeCandidates: vi.fn(),
  getChangePlan: vi.fn(),
  previewChangePlan: vi.fn(),
  detail: null as ChangePlan | null,
}));

vi.mock('./api', () => ({
  cancelChangePlan: vi.fn(), createChangePlan: mocks.createChangePlan, getChangeCandidates: mocks.getChangeCandidates,
  getChangePlan: mocks.getChangePlan, listChangePlans: mocks.listChangePlans, previewChangePlan: mocks.previewChangePlan,
  reviewChangePlan: vi.fn(), submitChangePlan: vi.fn(), updateChangePlan: vi.fn(), getChangeActivity: mocks.getChangeActivity,
}));
vi.mock('@/components/layout/app-shell', async (importOriginal) => ({ ...await importOriginal<typeof import('@/components/layout/app-shell')>(), AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Site One' } }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.detail = null; });

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
    fireEvent.change(screen.getByLabelText('Início planeado'), { target: { value: '2026-11-20T10:00' } });
    fireEvent.change(screen.getByLabelText('Fim planeado'), { target: { value: '2026-11-20T11:00' } });
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
    await vi.waitFor(() => expect(mocks.getChangePlan).toHaveBeenCalledTimes(6));
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
  const setup = (path = '/alteracoes') => {
    window.history.replaceState(null, '', path);
    mocks.listChangePlans.mockResolvedValue([core, vlan, old]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[{ entityType: 'DEVICE', entityId: 'device-1', label: 'Core-SW-01' }]], truncated: false });
    mocks.getChangePlan.mockImplementation(async (id: string) => [core, vlan, old].find((plan) => plan.id === id)!);
  };
  afterEach(() => { window.history.replaceState(null, '', '/'); });

  it('honours ?q= from the Phase B entity links and searches target labels', async () => {
    setup('/alteracoes?siteId=site-1&q=Troca+do+core');
    render(<ChangePlansPage />);
    expect(await screen.findByRole('button', { name: 'Troca do core' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renomear VLAN' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('1 de 3 alterações')).toBeInTheDocument();

    act(() => { window.history.replaceState(null, '', '/alteracoes?q=core-sw'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('button', { name: 'Troca do core' })).toBeInTheDocument();
  });

  it('filters by status tab with counts and keeps the tab in the URL', async () => {
    setup();
    render(<ChangePlansPage />);
    await screen.findByRole('button', { name: 'Troca do core' });
    expect(screen.getByRole('button', { name: 'Todas (3)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Canceladas (1)' }));
    expect(window.location.search).toContain('status=CANCELLED');
    expect(screen.getByRole('button', { name: 'Limpeza antiga' })).toBeInTheDocument();
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

  it('opens ?changeId= directly, lists the overlap and the activity fallback, and returns to the list', async () => {
    setup('/alteracoes?changeId=p1');
    render(<ChangePlansPage />);
    expect(await screen.findByRole('heading', { name: 'Troca do core' })).toBeInTheDocument();
    expect(mocks.getChangeActivity).toHaveBeenCalledWith('p1');
    expect(screen.getByText('A janela sobrepõe-se a outras alterações deste Site')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Renomear VLAN' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Core-SW-01' })).toHaveAttribute('href', '/infraestrutura?siteId=site-1&tab=devices&deviceId=device-1&focus=device');
    expect(await screen.findByRole('heading', { name: 'Atividade' })).toBeInTheDocument();
    expect(screen.getByText(/Mostra os marcos registados na alteração/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Todas as alterações' }));
    expect(window.location.search).not.toContain('changeId');
    expect(await screen.findByRole('heading', { name: 'Alterações Planeadas' })).toBeInTheDocument();
  });

  it('shows the full activity log when the API provides it', async () => {
    setup('/alteracoes?changeId=p1');
    mocks.getChangeActivity.mockResolvedValueOnce([{ id: 'a1', action: 'CHANGE_PLAN_UPDATED', at: '2026-11-19T09:00:00.000Z', actor: { username: 'ana', displayName: 'Ana Ops' }, revision: 2 }] as never);
    render(<ChangePlansPage />);
    expect(await screen.findByText('Rascunho editado')).toBeInTheDocument();
    expect(screen.getByText(/Ana Ops/)).toBeInTheDocument();
    expect(screen.queryByText(/Mostra os marcos registados/)).not.toBeInTheDocument();
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
