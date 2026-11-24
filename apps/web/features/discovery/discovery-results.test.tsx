import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { DiscoveryResultsTable, formatDurationMs } from './discovery-results';
import type { DiscoveryResult } from './api';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const result = (id: string, address: string, extra: Partial<DiscoveryResult> = {}): DiscoveryResult => ({ id, address, hostname: null, icmpReachable: true, responseMs: 2, openPorts: [22], status: 'PENDING', ipam: null, ...extra });
const results = [
  result('r1', '10.0.0.10', { hostname: 'srv-a', ipam: { ipAddressId: 'ip-1', state: 'OCCUPIED', hostId: 'h1', hostName: 'srv-a', activeReservation: null } }),
  result('r2', '10.0.0.2', { ipam: { ipAddressId: 'ip-2', state: 'FREE', activeReservation: { id: 'res', expiresAt: '2026-11-22T10:00:00.000Z' } } }),
  result('r3', '10.0.0.3', { status: 'APPROVED' }),
  result('r4', '10.0.0.4', { ipam: { ipAddressId: 'ip-4', state: 'SOMETHING_NEW' } }),
];

beforeEach(() => { mockedFetch.mockReset(); window.history.replaceState(null, '', '/descoberta'); });
afterEach(cleanup);

describe('Discovery results', () => {
  it('formats run durations', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(400)).toBe('< 1 s');
    expect(formatDurationMs(45_000)).toBe('45 s');
    expect(formatDurationMs(185_000)).toBe('3 min 05 s');
    expect(formatDurationMs(3_720_000)).toBe('1 h 02 min');
  });

  it('shows the IPAM status of each result', () => {
    render(<DiscoveryResultsTable results={results} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    const rows = within(screen.getByRole('region', { name: 'Resultados de sondas' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('OCCUPIED');
    expect(rows[0]).toHaveTextContent('Host srv-a');
    expect(rows[1]).toHaveTextContent('RESERVED');
    expect(rows[1]).toHaveTextContent('Reservado até');
    expect(rows[2]).toHaveTextContent('Não registado no IPAM');
    expect(rows[3]).toHaveTextContent('SOMETHING_NEW');
    // Readers: no selection, no review buttons.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprovar/ })).not.toBeInTheDocument();
  });

  it('filters by review and IPAM chips with counts, kept in the URL', () => {
    render(<DiscoveryResultsTable results={results} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    const table = () => within(screen.getByRole('region', { name: 'Resultados de sondas' }));
    const review = screen.getByRole('group', { name: 'Revisão' });
    const ipam = screen.getByRole('group', { name: 'IPAM' });
    expect(within(review).getByRole('button', { name: /Pendentes\s*3/ })).toBeEnabled();
    expect(within(review).getByRole('button', { name: /Ignorados\s*0/ })).toBeDisabled();
    // Unknown IPAM states still get a chip; an active reservation counts as RESERVED.
    expect(within(ipam).getByRole('button', { name: /SOMETHING_NEW\s*1/ })).toBeInTheDocument();
    expect(within(ipam).getByRole('button', { name: /Reservados\s*1/ })).toBeInTheDocument();
    expect(within(ipam).queryByRole('button', { name: /Livres/ })).not.toBeInTheDocument();

    fireEvent.click(within(review).getByRole('button', { name: /Pendentes/ }));
    expect(window.location.search).toBe('?resultsReview=PENDING');
    expect(table().getAllByRole('row')).toHaveLength(4);
    // IPAM counts follow the review filter (the approved result outside the IPAM drops out).
    expect(within(ipam).queryByRole('button', { name: /Fora do IPAM/ })).not.toBeInTheDocument();

    fireEvent.click(within(ipam).getByRole('button', { name: /Ocupados/ }));
    expect(table().getAllByRole('row')).toHaveLength(2);
    expect(table().getAllByRole('row')[1]).toHaveTextContent('10.0.0.10');
    expect(new URLSearchParams(window.location.search).get('resultsIpam')).toBe('OCCUPIED');
  });

  it('bulk approves the selected pending results and reports each item', async () => {
    const bulkDone = vi.fn();
    mockedFetch.mockResolvedValue({ status: 'APPROVED', total: 2, succeeded: 1, failed: 1, items: [{ id: 'r1', ok: true, status: 'APPROVED' }, { id: 'r2', ok: false, error: { statusCode: 404, code: 'DISCOVERY_RESULT_NOT_FOUND', message: 'Resultado não encontrado.' } }] });
    render(<DiscoveryResultsTable results={results} canEdit review={vi.fn()} bulkDone={bulkDone} />);

    expect(screen.getByRole('checkbox', { name: '10.0.0.3 já revisto' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar 10.0.0.10' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar 10.0.0.2' }));
    fireEvent.click(screen.getByRole('button', { name: /Aprovar selecionados/ }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aprovar 2' }));
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('1 de 2 aplicados.'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/discovery/results/bulk-review', { method: 'POST', body: JSON.stringify({ ids: ['r1', 'r2'], status: 'APPROVED' }) });
    expect(within(dialog).getByText('Resultado não encontrado.')).toBeInTheDocument();
    expect(bulkDone).toHaveBeenCalledTimes(1);
  });

  it('selecting all only picks pending rows', () => {
    render(<DiscoveryResultsTable results={results} canEdit review={vi.fn()} bulkDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos os resultados pendentes' }));
    expect(screen.getByText('3 selecionados')).toBeInTheDocument();
  });
});
