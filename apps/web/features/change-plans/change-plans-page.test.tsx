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
  it('keeps the impact section hidden while recalculation is pending, then reveals it with the matching timestamp', async () => {
    const plan: ChangePlan = {
      id: 'plan-1', siteId: 'site-1', title: 'Calibration Change', reason: 'Test preview transition',
      plannedStartAt: '2026-11-10T10:00:00.000Z', plannedEndAt: '2026-11-10T11:00:00.000Z',
      status: 'DRAFT', revision: 1, previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null,
      items: [{ entityType: 'DEVICE', entityId: 'device-1', operationSummary: 'Upgrade' }],
    };
    const generatedAt = '2026-11-09T15:00:00.000Z';
    const calculated: ImpactPreview = {
      analysisStatus: 'COMPLETE', revision: 1, generatedAt, knownImpacts: [{ entityType: 'DEVICE', entityId: 'device-2', label: 'Affected device', href: '/infraestrutura', depth: 1, dependencyPath: ['Connection'], freshness: 'CURRENT', confidence: 'RECORDED' }],
      maintenanceOverlaps: [], changeOverlaps: [], coverage: { status: 'COMPLETE', reason: 'Complete', latestInventoryUpdate: null, staleItems: 0, unknownFreshnessItems: 0 }, graphSignature: 'signature',
    };
    mocks.detail = plan;
    mocks.listChangePlans.mockResolvedValue([plan]);
    mocks.getChangeCandidates.mockResolvedValue({ groups: [[]], truncated: false });
    mocks.getChangePlan.mockImplementation(async () => mocks.detail);

    let resolvePreview!: (value: ImpactPreview) => void;
    const pendingPreview = new Promise<ImpactPreview>((resolve) => { resolvePreview = resolve; });
    mocks.previewChangePlan.mockImplementation(async () => {
      const result = await pendingPreview;
      mocks.detail = { ...plan, previewRevision: 1, previewSnapshot: result, previewedAt: generatedAt };
      return result;
    });

    render(<ChangePlansPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Calibration Change/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Recalcular pré-visualização' }));

    expect(await screen.findAllByText('A calcular…')).toHaveLength(2);
    expect(screen.queryByText('Impacto conhecido')).not.toBeInTheDocument();

    await act(async () => { resolvePreview(calculated); await pendingPreview; });

    expect(await screen.findByText('Affected device')).toBeInTheDocument();
    expect(screen.getByText(/^Calculada /)).toBeInTheDocument();
    expect(screen.getByText('Impacto conhecido')).toBeInTheDocument();
  });
});
