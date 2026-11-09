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
  it('shows impacts and the calculated timestamp together after success despite an older detail refetch', async () => {
    const plan: ChangePlan = {
      id: 'plan-1', siteId: 'site-1', title: 'Calibration Change', reason: 'Test preview transition',
      plannedStartAt: '2026-11-10T10:00:00.000Z', plannedEndAt: '2026-11-10T11:00:00.000Z',
      status: 'DRAFT', revision: 1, previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null,
      items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Upgrade' }],
    };
    const generatedAt = '2026-11-09T15:00:00.000Z';
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
    fireEvent.click(await screen.findByRole('button', { name: 'Recalcular pré-visualização' }));

    expect(await screen.findAllByText('A calcular…')).toHaveLength(2);
    expect(screen.queryByText('Impacto conhecido')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('A calcular a pré-visualização…');

    await act(async () => { resolvePreview(calculated); await pendingPreview; });

    const success = await screen.findByRole('status');
    expect(success).toHaveTextContent('Pré-visualização atualizada');
    const detail = screen.getByText('Pré-visualização').closest('.change-detail');
    const expectedTimestamp = new Date(generatedAt).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
    expect(detail).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    expect(detail?.querySelector('.impact-preview .change-summary-grid div strong')).toHaveTextContent('7');
    expect(detail?.querySelectorAll('.impact-group li')).toHaveLength(7);
    expect(detail).toHaveTextContent('Impacto conhecido');

    await act(async () => { resolveStaleDetail(plan); await staleDetail; });
    expect(detail).toHaveTextContent(`Calculada ${expectedTimestamp}`);
    expect(detail).toHaveTextContent('Affected device 1');
  });
});
