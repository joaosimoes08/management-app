import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import type { DiscoveryIdentity, DiscoveryIdentityCandidate, DiscoveryResult } from './api';
import { DiscoveryIdentityCell, identitySortValue, likelyExistingDevice } from './discovery-identity';
import { DiscoveryPromoteAction } from './discovery-promote';
import { DiscoveryResultsTable } from './discovery-results';

const locale = vi.hoisted(() => ({ current: 'pt-PT' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async () => {
  const real = await vi.importActual<typeof import('@/lib/i18n/i18n')>('@/lib/i18n/i18n');
  return { ...real, useOptionalI18n: () => ({ locale: locale.current, t: (key: string, fallback?: string, params?: Record<string, string | number>) => real.translateMessage(locale.current, key, fallback, params) }) };
});
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const candidate = (extra: Partial<DiscoveryIdentityCandidate> = {}): DiscoveryIdentityCandidate => ({
  deviceId: 'dev-1', deviceName: 'sw-core-01', siteId: 'site-lx', deviceStatus: 'ACTIVE', confidence: 'HIGH', score: 60,
  reasons: [{ code: 'SERIAL_MATCH', discovered: 'FOC1234X', registered: 'FOC1234X' }], ...extra,
});
const identity = (candidates: DiscoveryIdentityCandidate[], extra: Partial<DiscoveryIdentity> = {}): DiscoveryIdentity => ({ signals: ['SERIAL', 'MANAGEMENT_IP'], ambiguous: false, candidates, ...extra });
const contradicted = candidate({
  deviceId: 'dev-2', deviceName: 'sw-edge-02', siteId: null, confidence: 'LOW', score: -30,
  reasons: [{ code: 'SYSNAME_MATCH', discovered: 'sw-edge-02', registered: 'sw-edge-02' }, { code: 'SERIAL_MISMATCH', discovered: 'AAA111', registered: 'BBB222' }],
});

beforeEach(() => { mockedFetch.mockReset(); locale.current = 'pt-PT'; window.history.replaceState(null, '', '/descoberta'); });
afterEach(cleanup);

describe('identity helpers', () => {
  it('ranks by confidence then score and only hints uncontradicted HIGH candidates', () => {
    expect(identitySortValue(null)).toBeNull();
    expect(identitySortValue(identity([]))).toBeNull();
    expect(identitySortValue(identity([candidate()]))!).toBeGreaterThan(identitySortValue(identity([candidate({ confidence: 'MEDIUM', score: 90 })]))!);
    expect(likelyExistingDevice(identity([candidate()]))?.deviceId).toBe('dev-1');
    expect(likelyExistingDevice(identity([candidate({ confidence: 'MEDIUM' })]))).toBeNull();
    expect(likelyExistingDevice(identity([candidate({ reasons: contradicted.reasons })]))).toBeNull();
    expect(likelyExistingDevice(undefined)).toBeNull();
  });
});

describe('DiscoveryIdentityCell', () => {
  it('says when nothing matches', () => {
    render(<DiscoveryIdentityCell identity={identity([])} />);
    expect(screen.getByText('Sem equipamento correspondente')).toBeInTheDocument();
  });

  it('shows the top candidate as a badge with a device link, and every candidate and reason behind a disclosure', () => {
    const medium = candidate({ deviceId: 'dev-3', deviceName: 'sw-core-old', confidence: 'MEDIUM', score: 30, reasons: [{ code: 'MANAGEMENT_IP_MATCH', discovered: '10.0.0.1', registered: '10.0.0.1' }] });
    render(<DiscoveryIdentityCell identity={identity([candidate(), medium, contradicted], { ambiguous: true })} />);
    const top = screen.getAllByRole('link', { name: 'Abrir o equipamento sw-core-01' })[0];
    expect(top).toHaveAttribute('href', '/infraestrutura?siteId=site-lx&tab=devices&focus=device&deviceId=dev-1');
    expect(screen.getAllByText('Confiança alta')[0]).toBeInTheDocument();
    expect(screen.getByText('Ambíguo: há candidatos com a mesma confiança.')).toBeInTheDocument();
    const details = screen.getByText('Ver 3 candidatos').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Ver 3 candidatos'));
    const list = within(details);
    expect(list.getByRole('list', { name: 'Motivos para sw-core-01' })).toHaveTextContent('Número de série igual');
    expect(list.getByRole('list', { name: 'Motivos para sw-core-01' })).toHaveTextContent('Descoberto: FOC1234X · Registado: FOC1234X');
    expect(list.getByRole('list', { name: 'Motivos para sw-core-old' })).toHaveTextContent('IP de gestão igual');
    expect(list.getByText('Confiança média')).toBeInTheDocument();
    // The contradiction is flagged, in red, with both serials.
    const reasons = list.getByRole('list', { name: 'Motivos para sw-edge-02' });
    expect(reasons).toHaveTextContent('sysName igual ao nome do equipamento');
    const mismatch = within(reasons).getByText('Número de série diferente').closest('li')!;
    expect(mismatch).toHaveAttribute('data-tone', 'bad');
    expect(mismatch).toHaveTextContent('Contradição');
    expect(mismatch).toHaveTextContent('Descoberto: AAA111 · Registado: BBB222');
    // A device without a Site still links, without a siteId.
    expect(list.getByRole('link', { name: 'Abrir o equipamento sw-edge-02' })).toHaveAttribute('href', '/infraestrutura?tab=devices&focus=device&deviceId=dev-2');
    // Suggestion only: no buttons.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(list.getByText('Apenas sugestão: nada é associado nem fundido automaticamente.')).toBeInTheDocument();
  });

  it('flags a contradiction on the top candidate next to its badge', () => {
    render(<DiscoveryIdentityCell identity={identity([contradicted])} />);
    expect(screen.getByRole('note')).toHaveTextContent('Contradição');
    expect(screen.getAllByText('Confiança baixa')).toHaveLength(2);
    expect(screen.getByText('Ver motivos')).toBeInTheDocument();
  });

  it('is labelled in en-US and shows unknown codes as sent', () => {
    locale.current = 'en-US';
    render(<DiscoveryIdentityCell identity={identity([candidate({ reasons: [{ code: 'SERIAL_MATCH', discovered: 'X', registered: 'X' }, { code: 'MAC_MATCH', discovered: 'aa', registered: 'aa' }] }), contradicted])} />);
    expect(screen.getAllByText('High confidence')[0]).toBeInTheDocument();
    expect(screen.getByText('Show 2 candidates')).toBeInTheDocument();
    expect(screen.getByText('Serial number matches')).toBeInTheDocument();
    expect(screen.getByText('MAC_MATCH')).toBeInTheDocument();
    expect(screen.getByText('Serial number differs').closest('li')).toHaveTextContent('Contradiction');
    expect(screen.getByText('Discovered: AAA111 · Registered: BBB222')).toBeInTheDocument();
  });
});

describe('identity in the results table and the promote action', () => {
  const row = (extra: Partial<DiscoveryResult> = {}): DiscoveryResult => ({ id: 'r1', address: '10.0.0.1', hostname: 'sw-core', icmpReachable: true, responseMs: 2, openPorts: [161], status: 'PENDING', ipam: null, ...extra });

  it('adds the identity column only when the API sends identity', () => {
    const { unmount } = render(<DiscoveryResultsTable results={[row()]} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(screen.queryByRole('columnheader', { name: /Identidade/ })).not.toBeInTheDocument();
    unmount();
    render(<DiscoveryResultsTable results={[row({ identity: identity([candidate()]) }), row({ id: 'r2', address: '10.0.0.2', identity: identity([]) })]} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: /Identidade/ })).toBeInTheDocument();
    const rows = within(screen.getByRole('region', { name: 'Resultados de sondas' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('sw-core-01');
    expect(rows[1]).toHaveTextContent('Sem equipamento correspondente');
  });

  function renderPromote(result: DiscoveryResult) {
    const auth = { hasRole: (role: string) => role === 'NETWORK_OPERATOR' } as unknown as AuthContextValue;
    render(<AuthContext.Provider value={auth}><DiscoveryPromoteAction result={result} navigate={vi.fn()} /></AuthContext.Provider>);
  }

  it('hints a HIGH candidate next to "Promover a equipamento" and keeps the action', () => {
    renderPromote(row({ status: 'APPROVED', identity: identity([candidate()]) }));
    expect(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' })).toBeEnabled();
    const hint = screen.getByRole('note');
    expect(hint).toHaveTextContent('Provavelmente já existe: sw-core-01');
    expect(within(hint).getByRole('link', { name: 'Abrir o equipamento sw-core-01' })).toHaveAttribute('href', expect.stringContaining('deviceId=dev-1'));
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows no hint for MEDIUM or LOW candidates', () => {
    renderPromote(row({ status: 'APPROVED', identity: identity([candidate({ confidence: 'MEDIUM' })]) }));
    expect(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
