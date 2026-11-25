import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { impactFixture, pathFixture } from './__fixtures__/impact';

const mocks = vi.hoisted(() => ({ getTopologyImpact: vi.fn(), getTopologyPath: vi.fn() }));
vi.mock('./impact-api', async (importOriginal) => ({ ...await importOriginal<typeof import('./impact-api')>(), getTopologyImpact: mocks.getTopologyImpact, getTopologyPath: mocks.getTopologyPath }));

import { ImpactDialog, ImpactPanel, PathView } from './impact-panel';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ImpactPanel', () => {
  it('lists what goes down, cut-off and power-degraded devices, hosts, Portal apps and critical assets', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture());
    const onResult = vi.fn();
    render(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} siteId="site-1" onResult={onResult} />);
    expect(screen.getByRole('status')).toHaveTextContent('A calcular impacto…');
    const down = (await screen.findByRole('heading', { name: 'Vão abaixo · 1' })).parentElement!;
    expect(within(down).getByRole('link', { name: 'Core-SW-01' })).toHaveAttribute('href', '/infraestrutura/equipamentos/core?siteId=site-1');
    expect(within(down).getByText('Origem')).toBeInTheDocument();
    const cut = screen.getByRole('heading', { name: 'Ficam sem caminho · 2' }).parentElement!;
    expect(within(cut).getByRole('link', { name: 'Access-SW-08' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Perdem uma alimentação (continuam ligados) · 1' }).parentElement).toHaveTextContent('Server-01');
    expect(screen.getByRole('heading', { name: 'Hosts e serviços · 1' }).parentElement).toHaveTextContent('https:443');
    expect(screen.getByRole('link', { name: 'Intranet' })).toHaveAttribute('href', 'https://app-host.local');
    const tiers = screen.getByRole('heading', { name: 'Ativos críticos por tier · 1' }).parentElement!;
    expect(within(tiers).getByText('Tier 1')).toBeInTheDocument();
    expect(within(tiers).getByRole('link', { name: 'Access-SW-07' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver na Topologia/ })).toHaveAttribute('href', '/topology?siteId=site-1&impact=device%3Acore');
    expect(screen.queryByTestId('impact-truncated')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ origin: expect.objectContaining({ id: 'core' }) })), { timeout: 4000 });
    expect(mocks.getTopologyImpact).toHaveBeenCalledWith({ kind: 'DEVICE', id: 'core' }, { includeLogical: false });
  });

  it('shows a Portal app with a non-http(s) URL as plain text, never as a link', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture({ applications: [
      { id: 'a1', name: 'Intranet', url: 'https://app-host.local', category: null, matchedHost: 'app-host.local' },
      { id: 'a2', name: 'Legacy', url: 'javascript:alert(1)', category: null, matchedHost: 'app-host.local' },
    ] }));
    render(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} siteId="site-1" />);
    expect(await screen.findByRole('link', { name: 'Intranet' })).toHaveAttribute('href', 'https://app-host.local');
    expect(screen.getByTestId('impact-unsafe-url')).toHaveTextContent('Legacy');
    expect(screen.queryByRole('link', { name: 'Legacy' })).not.toBeInTheDocument();
  });

  it('warns when the search hit the depth limit, counts hidden devices and re-runs with logical links', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture({ truncated: true, hiddenCount: 3 }));
    render(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} onMap />);
    expect(await screen.findByTestId('impact-truncated')).toHaveTextContent('Pesquisa interrompida no limite de profundidade.');
    expect(screen.getByTestId('impact-truncated')).toHaveTextContent('12');
    expect(screen.getByText('Equipamentos fora do teu âmbito (não mostrados):').parentElement).toHaveTextContent('3');
    expect(screen.queryByRole('link', { name: /Ver na Topologia/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Incluir ligações lógicas'));
    await vi.waitFor(() => expect(mocks.getTopologyImpact).toHaveBeenLastCalledWith({ kind: 'DEVICE', id: 'core' }, { includeLogical: true }));
  });

  it('says when nothing was found, without claiming zero impact, and flags a Site without gateways', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture({ down: [], affected: [], powerDegraded: [], hosts: [], applications: [], anchorDeviceIds: [], critical: { T1: [], T2: [], T3: [], untiered: [] }, counts: { down: 0, affected: 0, powerDegraded: 0, hosts: 0, services: 0, applications: 0, tier1: 0 } }));
    render(<ImpactPanel target={{ kind: 'PDU', id: 'pdu-1' }} />);
    expect(await screen.findByText('Este resultado não confirma impacto zero.')).toBeInTheDocument();
    expect(screen.getByTestId('impact-no-gateway')).toHaveTextContent('Não há router nem firewall visível');
  });

  it('flags the largest-segment fallback even when the API picked an anchor, but not explicit or gateway anchors', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture({ anchorMode: 'largest-segment', anchorDeviceIds: ['acc-2'] }));
    render(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} />);
    expect(await screen.findByTestId('impact-no-gateway')).toHaveTextContent('maior segmento de rede');
    cleanup();
    for (const anchorMode of ['explicit', 'gateway-devices']) {
      mocks.getTopologyImpact.mockResolvedValue(impactFixture({ anchorMode, anchorDeviceIds: ['fw'] }));
      render(<ImpactPanel target={{ kind: 'DEVICE', id: `core-${anchorMode}` }} />);
      await screen.findByRole('heading', { name: 'Vão abaixo · 1' });
      expect(screen.queryByTestId('impact-no-gateway')).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('calls an inline onResult once per result, not on every render', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture());
    const seen: unknown[] = [];
    const { rerender } = render(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} onResult={(value) => seen.push(value)} />);
    await screen.findByRole('heading', { name: 'Vão abaixo · 1' });
    const calls = seen.length;
    rerender(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} onResult={(value) => seen.push(value)} />);
    rerender(<ImpactPanel target={{ kind: 'DEVICE', id: 'core' }} onResult={(value) => seen.push(value)} />);
    expect(seen).toHaveLength(calls);
    expect(seen.at(-1)).toEqual(expect.objectContaining({ origin: expect.objectContaining({ id: 'core' }) }));
    expect(mocks.getTopologyImpact).toHaveBeenCalledTimes(1);
  });

  it('shows the API error', async () => {
    mocks.getTopologyImpact.mockRejectedValue(new Error('Bastidor não encontrado'));
    render(<ImpactPanel target={{ kind: 'RACK', id: 'r1' }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Bastidor não encontrado');
  });
});

describe('ImpactDialog', () => {
  it('switches between the rack and its PDUs', async () => {
    mocks.getTopologyImpact.mockResolvedValue(impactFixture());
    const close = vi.fn();
    render(<ImpactDialog targets={[{ kind: 'RACK', id: 'r1', label: 'R01' }, { kind: 'PDU', id: 'p1', label: 'PDU UPS' }]} close={close} />);
    expect(screen.getByRole('dialog', { name: 'Impacto' })).toBeInTheDocument();
    await vi.waitFor(() => expect(mocks.getTopologyImpact).toHaveBeenCalledWith({ kind: 'RACK', id: 'r1' }, { includeLogical: false }));
    fireEvent.change(screen.getByLabelText('O que vai abaixo'), { target: { value: '1' } });
    await vi.waitFor(() => expect(mocks.getTopologyImpact).toHaveBeenLastCalledWith({ kind: 'PDU', id: 'p1' }, { includeLogical: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(close).toHaveBeenCalled();
  });
});

describe('PathView', () => {
  const devices = [{ id: 'acc-2', name: 'Access-SW-08' }, { id: 'fw', name: 'FW-01' }];

  it('lists the hops, hides out-of-scope devices and orients each link from the current step', async () => {
    mocks.getTopologyPath.mockResolvedValue(pathFixture());
    const onResult = vi.fn();
    render(<PathView devices={devices} initialFrom="acc-2" onResult={onResult} />);
    const show = screen.getByRole('button', { name: 'Mostrar caminho' });
    expect(show).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Equipamento de destino do caminho'), { target: { value: 'fw' } });
    await act(async () => { fireEvent.click(show); });
    expect(mocks.getTopologyPath).toHaveBeenCalledWith('acc-2', 'fw', { includeLogical: false });
    const steps = within(screen.getByRole('list', { name: 'Caminho documentado' })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[1]).toHaveTextContent('Equipamento fora do teu âmbito');
    // The link's source is FW-01, so from the hidden step it reads target → source.
    expect(steps[1]).toHaveTextContent('ge-0/0/1 → port1');
    expect(onResult).toHaveBeenCalledWith(pathFixture());
    fireEvent.click(screen.getByRole('button', { name: 'Limpar caminho' }));
    expect(onResult).toHaveBeenLastCalledWith(null);
  });

  it('explains when there is no documented path', async () => {
    mocks.getTopologyPath.mockResolvedValue({ found: false, reason: 'NO_PATH', maxDepth: 12, includeLogical: false, steps: [], connections: [] });
    render(<PathView devices={devices} initialFrom="acc-2" />);
    fireEvent.change(screen.getByLabelText('Equipamento de destino do caminho'), { target: { value: 'fw' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mostrar caminho' })); });
    expect(screen.getByRole('status')).toHaveTextContent('Não há caminho documentado');
  });
});
