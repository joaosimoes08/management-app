import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/errors';
import type { RackPowerSummary } from '../../api';
import type { Rack } from '../../types';
import { RackDetail } from './rack-detail';

const api = vi.hoisted(() => ({ getRackPowerSummary: vi.fn() }));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api')>()), getRackPowerSummary: api.getRackPowerSummary }));
vi.mock('./rack-device-zoom', () => ({ RackDeviceZoom: () => null }));
vi.mock('./rack-unit-reservations', () => ({ RackUnitReservations: () => null }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'en', t: (key: string, fallback?: string) => fallback ?? key }) }));

class TestResizeObserver { observe() {} disconnect() {} unobserve() {} }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  localStorage.clear();
  api.getRackPowerSummary.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rack: Rack = {
  id: 'rack-a', name: 'Core', roomId: 'room-1', units: 42,
  devices: [
    { id: 'srv', name: 'Server 1', type: 'SERVER', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 10, rackUnitSize: 2 },
    { id: 'sw', name: 'Switch', type: 'SWITCH', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 20, rackUnitSize: 1 },
  ],
  pdus: [{ id: 'pdu-s', rackId: 'rack-a', source: 'SUPPLIER', name: 'PDU A', outletCount: 32, budgetWatts: 1000, connections: [] }],
};

const summary = (overrides: Partial<RackPowerSummary> = {}): RackPowerSummary => ({
  thresholds: { warningPercent: 80, criticalPercent: 90 },
  level: 'warning',
  capacity: { watts: 1000, bySource: { SUPPLIER: 1000 }, missingBudgetPduIds: [] },
  draw: { estimatedWatts: 850, bySource: { SUPPLIER: 850 }, worstFailoverWatts: null },
  utilisation: { bySource: { SUPPLIER: 85 }, worstFailoverPercent: null },
  outlets: { used: 3, total: 32, free: 29, percent: 9.4, level: 'ok' },
  pdus: [{ id: 'pdu-s', name: 'PDU A', source: 'SUPPLIER', budgetWatts: 1000, estimatedWatts: 850, wattsPercent: 85, level: 'warning' }],
  nearLimit: {
    pdus: [{ id: 'pdu-s', name: 'PDU A', source: 'SUPPLIER', level: 'warning', reasons: ['watts'] }],
    devices: [{ id: 'srv', name: 'Server 1', estimatedWatts: 600, pduIds: ['pdu-s'], level: 'critical' }, { id: 'sw', name: 'Switch', level: 'ok' }],
  },
  // Fields the UI does not know yet must not break it.
  ...({ futureField: { anything: true } } as object),
  ...overrides,
});

const renderRack = (value: Rack = rack) => render(<RackDetail rack={value} onOut={vi.fn()} onDevice={vi.fn()} canEdit={false} onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} />);

describe('Rack power summary strip', () => {
  it('shows the summary, near-limit PDUs and highlights near-limit devices and PDUs', async () => {
    api.getRackPowerSummary.mockResolvedValue(summary());
    const { container } = renderRack();
    expect(await screen.findByTestId('rack-power-level')).toHaveTextContent('Energia em aviso');
    expect(api.getRackPowerSummary).toHaveBeenCalledWith('rack-a', { warningPercent: undefined, criticalPercent: undefined });
    expect(screen.getByText('Utilização Rede').nextSibling).toHaveTextContent('85%');
    expect(screen.getByText('Tomadas ocupadas').nextSibling).toHaveTextContent('3/32 (9,4%)');
    expect(screen.getByTestId('rack-power-near-limit')).toHaveTextContent('PDU A — perto do limite em: potência');
    expect(screen.getByTestId('rack-power-near-limit')).toHaveTextContent('Server 1');
    expect(screen.getByTestId('rack-power-near-limit')).not.toHaveTextContent('Switch');
    await waitFor(() => expect(container.querySelector('.rack-overlay[data-power-level="over"]')).not.toBeNull());
    expect(container.querySelectorAll('.rack-overlay[data-power-level]')).toHaveLength(1);
    expect(container.querySelector('.rack-pdu')).toHaveAttribute('data-level', 'warn');
  });

  it('does not request a summary for a rack without PDUs', () => {
    renderRack({ ...rack, pdus: [] });
    expect(api.getRackPowerSummary).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rack-power-strip')).toBeNull();
  });

  it('shows the API message when the summary fails', async () => {
    api.getRackPowerSummary.mockRejectedValue(new ApiRequestError('Sem acesso a este bastidor.', 403, { code: 'FORBIDDEN', message: 'Sem acesso a este bastidor.' }));
    renderRack();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem acesso a este bastidor.');
  });

  it('edits the thresholds in a modal, shows a 400 and stores valid values', async () => {
    api.getRackPowerSummary.mockResolvedValue(summary());
    renderRack();
    fireEvent.click(await screen.findByRole('button', { name: 'Limiares de energia' }));
    const warning = screen.getByLabelText(/Aviso/) as HTMLInputElement;
    const critical = screen.getByLabelText(/Crítico/) as HTMLInputElement;
    expect(warning.value).toBe('80');

    api.getRackPowerSummary.mockRejectedValueOnce(new ApiRequestError('warningPercent must be lower than criticalPercent', 400, { code: 'POWER_THRESHOLD_INVALID', message: 'warningPercent must be lower than criticalPercent' }));
    fireEvent.change(warning, { target: { value: '95' } });
    fireEvent.submit(warning.closest('form')!);
    expect(await screen.findByText('warningPercent must be lower than criticalPercent')).toBeInTheDocument();
    expect(localStorage.getItem('mgmt.rack-power-thresholds')).toBeNull();

    api.getRackPowerSummary.mockResolvedValue(summary({ thresholds: { warningPercent: 70, criticalPercent: 95 } }));
    fireEvent.change(warning, { target: { value: '70' } });
    fireEvent.change(critical, { target: { value: '95' } });
    fireEvent.submit(warning.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.getRackPowerSummary).toHaveBeenCalledWith('rack-a', { warningPercent: 70, criticalPercent: 95 });
    expect(JSON.parse(localStorage.getItem('mgmt.rack-power-thresholds') ?? '{}')).toEqual({ warningPercent: 70, criticalPercent: 95 });
    expect(screen.getByText(/Limiares: aviso 70%/)).toBeInTheDocument();
  });
});
