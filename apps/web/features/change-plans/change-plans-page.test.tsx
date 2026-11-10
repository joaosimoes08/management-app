import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePlansPage } from './change-plans-page';
import type { ChangePlan, ImpactPreview } from './api';

const mocks = vi.hoisted(() => ({
  listChangePlans: vi.fn(),
  getChangeCandidates: vi.fn(),
  getChangePlan: vi.fn(),
  previewChangePlan: vi.fn(),
  detail: null as ChangePlan | null,
}));

vi.mock('./api', () => ({
  cancelChangePlan: vi.fn(), createChangePlan: vi.fn(), getChangeCandidates: mocks.getChangeCandidates,
  getChangePlan: mocks.getChangePlan, listChangePlans: mocks.listChangePlans, previewChangePlan: mocks.previewChangePlan,
  reviewChangePlan: vi.fn(), submitChangePlan: vi.fn(), updateChangePlan: vi.fn(),
}));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Site One' } }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.detail = null; });

describe('ChangePlansPage impact preview transition', () => {
  it('keeps the first calculation pending, then shows its saved timestamp and impacts together despite a stale detail refetch', async () => {
    const plan: ChangePlan = {
      id: 'plan-1', siteId: 'site-1', title: 'Calibration Change', reason: 'Test preview transition',
      plannedStartAt: '2026-11-10T10:00:00.000Z', plannedEndAt: '2026-11-10T11:00:00.000Z',
      status: 'DRAFT', revision: 1, previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null,
      items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Upgrade' }],
    };
    const generatedAt = '2026-11-09T15:00:00.000Z';
    const calculated: ImpactPreview = {
      analysisStatus: 'COMPLETE', revision: 1, generatedAt, knownImpacts: Array.from({ length: 6 }, (_, index) => ({ entityType: 'DEVICE' as const, entityId: `device-${index + 2}`, label: `Affected device ${index + 1}`, href: '/infraestrutura', depth: 1, dependencyPath: ['Connection'], freshness: 'CURRENT' as const, confidence: 'RECORDED' as const })),
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
    expect(screen.getByRole('button', { name: /Calibration Change/ })).toHaveTextContent('Pré-visualização: Por calcular');
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
    expect(detail?.querySelector('.impact-preview .change-summary-grid div strong')).toHaveTextContent('6');
    expect(detail?.querySelectorAll('.impact-group li')).toHaveLength(6);
    expect(detail).toHaveTextContent('Impacto conhecido');
    expect(screen.getByRole('button', { name: /Calibration Change/ })).toHaveTextContent(`Pré-visualização: Calculada ${expectedTimestamp}`);
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
    expect(detail?.querySelectorAll('.impact-group li')).toHaveLength(6);
    expect(screen.getByRole('status')).toHaveTextContent('Pré-visualização atualizada');
    expect(screen.getByRole('button', { name: 'Recalcular pré-visualização' })).toBeInTheDocument();

    // Reopening the plan after stale list/detail reads still uses the saved result.
    fireEvent.click(screen.getByRole('button', { name: /Calibration Change/ }));
    await vi.waitFor(() => expect(mocks.getChangePlan).toHaveBeenCalledTimes(4));
    expect(detail).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    expect(detail?.querySelectorAll('.impact-group li')).toHaveLength(6);
    expect(screen.getByRole('button', { name: /Calibration Change/ })).toHaveTextContent(`Pré-visualização: Calculada ${expectedTimestamp}`);
  });
});
