import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnmpHealthBadge } from './health-badge';
import { SnmpHealthDetails, SnmpHealthPanel, formatBytes } from './health-panel';
import { DevicePicker, filterDeviceOptions } from './device-picker';
import type { SnmpDeviceHealth, SnmpHealthSummaryItem } from './health-api';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));

afterEach(() => { cleanup(); mocks.apiFetch.mockReset(); });

const withQuery = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const summary = (status: SnmpHealthSummaryItem['status'], extra: Partial<SnmpHealthSummaryItem> = {}): SnmpHealthSummaryItem => ({ deviceId: 'd1', status, observedAt: '2026-11-24T10:00:00.000Z', issueCount: 0, rebootDetectedAt: null, stale: false, ...extra });

const health: SnmpDeviceHealth = {
  vendor: 'cisco', status: 'DEGRADED', observedAt: '2026-11-24T10:00:00.000Z', jobId: 'j1', uptimeTicks: '100', bootedAt: '2026-11-20T08:00:00.000Z', rebootDetectedAt: '2026-11-20T08:00:00.000Z', rebootCount: 1,
  cpu: { fiveSecondPercent: 12, oneMinutePercent: 10, fiveMinutePercent: 9 },
  memory: { usedPercent: 41.6, usedBytes: '446676598', totalBytes: '1073741824' },
  issueCount: 2,
  details: {
    temperatures: [{ index: 1, description: 'Inlet', celsius: 31, thresholdCelsius: 60, state: 'normal' }],
    fans: [{ index: 1, description: 'Fan 1', state: 'normal' }, { index: 2, description: 'Fan 2', state: 'critical' }],
    powerSupplies: [{ index: 1, description: 'PSU 1', state: 'normal', source: 'ac' }, { index: 2, description: 'PSU 2', state: 'normal', source: 'ac' }],
    stack: { ringRedundant: false, members: [{ index: 1, switchNumber: 1, name: 'sw1', role: 'active', state: 'ready', ready: true }, { index: 2, switchNumber: 2, name: 'sw2', role: 'standby', state: 'ready', ready: true }] },
    issues: [{ code: 'FAN_FAULT', component: 'Fan 2', state: 'critical' }, { code: 'STACK_RING_NOT_REDUNDANT', component: 'stack', state: 'warning' }],
    unavailable: [],
  },
};

describe('SnmpHealthBadge', () => {
  it('maps each state to its pt-PT label and an existing badge tone, never colour alone', () => {
    render(<><SnmpHealthBadge item={summary('OK')} /><SnmpHealthBadge item={summary('DEGRADED', { issueCount: 2 })} /><SnmpHealthBadge item={summary('UNKNOWN')} /><SnmpHealthBadge item={null} /></>);
    const badges = screen.getAllByRole('img');
    expect(badges.map((badge) => badge.getAttribute('data-health'))).toEqual(['OK', 'DEGRADED', 'UNKNOWN', 'NONE']);
    expect(badges[0]).toHaveTextContent('OK'); expect(badges[0]).toHaveClass('state-badge', 'occupied');
    expect(badges[1]).toHaveTextContent('Degradado · 2'); expect(badges[1]).toHaveClass('reserved');
    expect(badges[2]).toHaveTextContent('Desconhecido');
    expect(badges[3]).toHaveTextContent('Sem dados');
    expect(badges[1].getAttribute('aria-label')).toMatch(/Saúde SNMP: Degradado\. 2 problemas/);
  });

  it('marks an old reading as stale in the accessible name', () => {
    render(<SnmpHealthBadge item={summary('OK', { stale: true })} />);
    expect(screen.getByRole('img')).toHaveClass('is-stale');
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/desatualizad/i);
  });
});

describe('Device 360 health panel', () => {
  it('shows CPU, memory, temperature, PSUs, fans, stack, reboot and the issues', () => {
    render(<SnmpHealthDetails health={health} />);
    expect(screen.getByRole('group', { name: 'Problemas reportados pelo equipamento' })).toHaveTextContent('Fan 2');
    const facts = screen.getByText('CPU').closest('dl')!;
    expect(within(facts).getByText(/12%.*10%.*9%/)).toBeInTheDocument();
    expect(within(facts).getByText(/42%/)).toHaveTextContent('1 GiB');
    expect(within(facts).getByText(/Inlet: 31 °C/)).toBeInTheDocument();
    expect(within(facts).getByText('Fan 2')).toBeInTheDocument();
    expect(within(facts).getByText(/2 de 2 membros/)).toHaveTextContent(/anel sem redundância/i);
    expect(screen.getByText('Último reinício')).toBeInTheDocument();
  });

  it('lists the sections the device does not report', () => {
    render(<SnmpHealthDetails health={{ ...health, cpu: { fiveSecondPercent: null, oneMinutePercent: null, fiveMinutePercent: null }, details: { ...health.details, unavailable: ['cpu', 'stack'] } }} />);
    expect(screen.getByText('Secções indisponíveis').nextElementSibling).toHaveTextContent(/CPU.*Stack/);
  });

  it('loads the reading and falls back to "Sem dados" when there is none', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ deviceId: 'd1', health: null });
    render(withQuery(<SnmpHealthPanel deviceId="d1" />));
    expect(await screen.findByText('Sem dados')).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/snmp/devices/d1/health');
  });

  it('offers a retry when the reading fails', async () => {
    mocks.apiFetch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ deviceId: 'd1', health });
    render(withQuery(<SnmpHealthPanel deviceId="d1" />));
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Problemas reportados pelo equipamento')).toBeInTheDocument();
  });

  it('formats byte counts sent as strings', () => {
    expect(formatBytes('1073741824')).toBe('1 GiB');
    expect(formatBytes(null)).toBe('—');
  });
});

describe('DevicePicker', () => {
  const options = [
    { id: 'a', name: 'core-sw-01', managementIp: '10.0.0.1', type: 'SWITCH' },
    { id: 'b', name: 'edge-rtr', managementIp: '10.0.0.2', type: 'ROUTER' },
    { id: 'c', name: 'Firewall Ação', managementIp: null, type: 'FIREWALL' },
  ];
  function Harness({ onChange = vi.fn() }: { onChange?: (id: string) => void }) {
    const [value, setValue] = useState('a');
    return <DevicePicker options={options} value={value} onChange={(id) => { setValue(id); onChange(id); }} health={new Map([['b', summary('DEGRADED', { deviceId: 'b', issueCount: 1 })]])} />;
  }

  it('filters by name, IP or type, ignoring case and accents', () => {
    expect(filterDeviceOptions(options, 'ROUTER').map((o) => o.id)).toEqual(['b']);
    expect(filterDeviceOptions(options, '10.0.0.1').map((o) => o.id)).toEqual(['a']);
    expect(filterDeviceOptions(options, 'acao').map((o) => o.id)).toEqual(['c']);
    expect(filterDeviceOptions(options, '').length).toBe(3);
  });

  it('is a labelled combobox that shows the current device', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Equipamento' });
    expect(input).toHaveValue('core-sw-01 · 10.0.0.1');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('types to filter, moves with the arrows and picks with Enter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Equipamento' });
    fireEvent.change(input, { target: { value: '10.0.0' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('2 equipamentos encontrados');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toContain('option-b');
    expect(within(screen.getAllByRole('option')[1]).getByRole('img')).toHaveTextContent('Degradado');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(input).toHaveValue('edge-rtr · 10.0.0.2');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape without changing the device, and says when nothing matches', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Equipamento' });
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(within(screen.getByRole('listbox')).getByText('Nenhum equipamento corresponde à pesquisa.')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('core-sw-01 · 10.0.0.1');
  });

  it('picks with the mouse', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Equipamento' }));
    fireEvent.click(screen.getByRole('option', { name: /Firewall Ação/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('c'));
    expect(screen.getByRole('combobox')).toHaveValue('Firewall Ação · sem IP de gestão');
  });
});
