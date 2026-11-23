import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { SnmpSetupPanel } from './snmp-setup-panel';
import { preRegisterHref, SnmpUnknownTrapsView } from './snmp-unknown-traps';
import { SnmpSetupWizard } from './snmp-setup-wizard';
import { SnmpFleetSummaryView } from './snmp-fleet';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

const receiver = (patch: Record<string, unknown> = {}) => ({ listenAll: false, selectedInterfaceIds: ['eth0'], interfaces: [{ id: 'eth0', instanceId: 'h', name: 'eth0', address: '10.0.0.5', internal: false, lastSeenAt: '2026-11-23T10:00:00.000Z' }], engineId: '800000090300AABBCCDDEEFF', engineIdSource: 'STORED', trapPort: 162, v2cAllowed: false, refreshSeconds: 30, ...patch });

beforeEach(() => { mockedFetch.mockReset(); });
afterEach(cleanup);

describe('SnmpSetupPanel', () => {
  it('shows the receiver, port, engine ID, trap-source warning and copy-ready v3 lines, and no v2c lines when an admin disabled it', async () => {
    mockedFetch.mockResolvedValue(receiver());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    wrap(<SnmpSetupPanel managementIp="10.1.1.1" username="netops" authProtocol="SHA256" privProtocol="AES128" canReadReceiver lastTrapReceivedAt={null} />);
    expect(await screen.findByText('800000090300AABBCCDDEEFF')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument();
    expect(screen.getByText('A aguardar a primeira trap deste equipamento.')).toBeInTheDocument();
    expect(screen.getByText(/O trap-source tem de ser o IP de gestão \(10\.1\.1\.1\)/)).toBeInTheDocument();
    expect(screen.queryByText('SNMPv2c (polling e traps)')).not.toBeInTheDocument();
    expect(screen.getByText(/O SNMPv2c foi desativado por um administrador \(SNMP_ALLOW_V2C=false\)/)).toBeInTheDocument();
    expect(screen.getByText('Opcional: informs SNMPv3 (com confirmação de entrega)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar: SNMPv3 authPriv (polling e traps)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('snmp-server host 10.0.0.5 version 3 priv netops')));
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/settings/snmp-listeners');
  });

  it('says the engine ID is not generated yet, shows the last trap, and adds v2c lines with the trade-off note after v3', async () => {
    mockedFetch.mockResolvedValue(receiver({ engineId: null, engineIdSource: null, v2cAllowed: true, trapPort: 1162 }));
    wrap(<SnmpSetupPanel managementIp="10.1.1.1" canReadReceiver lastTrapReceivedAt="2026-11-23T10:00:00.000Z" />);
    expect(await screen.findByText('1162')).toBeInTheDocument();
    expect(screen.getByText(/Ainda não gerado: o recetor SNMP ainda não arrancou/)).toBeInTheDocument();
    expect(screen.getByText(/Última trap recebida:/)).toBeInTheDocument();
    const titles = screen.getAllByRole('button', { name: /^Copiar: / }).map((button) => button.getAttribute('aria-label'));
    expect(titles).toEqual(['Copiar: SNMPv3 authPriv (polling e traps)', 'Copiar: SNMPv2c (polling e traps)']);
    expect(screen.getByRole('note')).toHaveTextContent('Use apenas em redes de gestão isoladas; prefira SNMPv3 (authPriv).');
    expect(screen.getByText(/snmp-server host 10\.0\.0\.5 version 2c <COMMUNITY> udp-port 1162/)).toBeInTheDocument();
    expect(screen.queryByText(/laborat/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Opcional: informs SNMPv3 (com confirmação de entrega)')).not.toBeInTheDocument();
  });

  it('does not read the receiver settings for non-admins', () => {
    wrap(<SnmpSetupPanel managementIp="10.1.1.1" canReadReceiver={false} />);
    expect(screen.getByText('Só administradores veem o endereço do recetor.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe('SnmpUnknownTrapsView', () => {
  const sources = { items: [
    { sourceAddress: '10.9.9.9', count: 12, firstSeenAt: '2026-11-22T10:00:00.000Z', lastSeenAt: '2026-11-23T10:00:00.000Z', lastTrapLabel: 'linkDown', preRegistered: false },
    { sourceAddress: '10.8.8.8', count: 1, firstSeenAt: '2026-11-23T09:00:00.000Z', lastSeenAt: '2026-11-23T09:00:00.000Z', lastTrapOid: '1.3.6.1.6.3.1.1.5.1', preRegistered: true },
  ] };

  it('lists sources with counts and links Pré-registar to the Descoberta dialog', async () => {
    mockedFetch.mockResolvedValue(sources);
    wrap(<SnmpUnknownTrapsView />);
    const table = await screen.findByRole('region', { name: 'Traps de equipamentos desconhecidos' });
    expect(within(table).getByText('10.9.9.9')).toBeInTheDocument();
    expect(within(table).getByText('12')).toBeInTheDocument();
    expect(within(table).getByText('linkDown')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Pré-registar 10.9.9.9' })).toHaveAttribute('href', '/descoberta?tab=snmp&preRegister=10.9.9.9');
    expect(within(table).queryByRole('link', { name: 'Pré-registar 10.8.8.8' })).not.toBeInTheDocument();
    expect(preRegisterHref('fe80::1')).toBe('/descoberta?tab=snmp&preRegister=fe80%3A%3A1');
  });

  it('hides the existing traps of a source only after confirming', async () => {
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST' ? { sourceAddress: '10.9.9.9', ignored: 12 } : sources);
    wrap(<SnmpUnknownTrapsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ocultar as traps existentes de 10.9.9.9' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    expect(within(dialog).getByText('Ocultar as traps já recebidas de 10.9.9.9? Deixam de aparecer nesta lista e o alerta desta origem fecha. O IP não fica bloqueado: traps novas deste IP voltam a aparecer aqui.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ocultar traps existentes' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/snmp/traps/unmatched/ignore', { method: 'POST', body: JSON.stringify({ sourceAddress: '10.9.9.9' }) }));
    expect(await screen.findByText('10.9.9.9: 12 traps existentes ocultadas.')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockedFetch.mockResolvedValue({ items: [] });
    wrap(<SnmpUnknownTrapsView />);
    expect(await screen.findByText('Nenhuma trap de origem desconhecida.')).toBeInTheDocument();
  });
});

describe('SnmpSetupWizard', () => {
  it('walks credential → test → polling → first sync, showing the real test result', async () => {
    const state = { credentials: [] as unknown[], jobs: [] as unknown[], config: null as unknown };
    const calls: Array<[string, string | undefined, unknown]> = [];
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push([url, init?.method, init?.body ? JSON.parse(String(init.body)) : undefined]);
      if (url === '/api/v1/settings/snmp-listeners') return receiver();
      if (url.endsWith('/credentials') && init?.method === 'POST') { state.credentials = [{ id: 'c1', purpose: 'READ', version: 'V3', username: 'netops', authProtocol: 'SHA256', configured: true }]; return state.credentials[0]; }
      if (url.endsWith('/credentials/READ/test')) { state.jobs = [{ id: 't1', type: 'CREDENTIAL_TEST', status: 'COMPLETED', createdAt: '2026-11-23T10:00:00.000Z', result: { reachable: true, durationMs: 31, sysName: 'core-sw-01' } }]; return { id: 't1', type: 'CREDENTIAL_TEST', status: 'PENDING', createdAt: '2026-11-23T10:00:00.000Z' }; }
      if (url.endsWith('/config')) { state.config = { id: 'cfg', ...(JSON.parse(String(init?.body))) }; return state.config; }
      if (url.endsWith('/poll')) { state.jobs = [...state.jobs, { id: 'p1', type: 'POLL', status: 'COMPLETED', createdAt: '2026-11-23T10:01:00.000Z' }]; return { id: 'p1', type: 'POLL', status: 'PENDING', createdAt: '2026-11-23T10:01:00.000Z' }; }
      if (url === '/api/v1/snmp/devices/d1') return { config: state.config, credentials: state.credentials, latestSnapshot: null, jobs: state.jobs, drifts: [], traps: [], setEnabled: false };
      throw new Error(`unexpected ${url}`);
    });
    const close = vi.fn(); const onDone = vi.fn();
    wrap(<SnmpSetupWizard deviceId="d1" deviceName="core-sw-01" close={close} onDone={onDone} />);
    expect(screen.getByRole('dialog', { name: 'Configurar SNMP' })).toBeInTheDocument();
    // SNMP_ALLOW_V2C=false in this receiver: v3 is preselected and v2c is not offered.
    expect(screen.getByRole('radio', { name: /SNMPv3 \(authPriv\)/ })).toBeChecked();
    expect(await screen.findByText(/O SNMPv2c foi desativado por um administrador/)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /SNMPv2c/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'netops' } });
    fireEvent.change(screen.getByLabelText('Auth key'), { target: { value: 'auth-secret-1' } });
    fireEvent.change(screen.getByLabelText('Privacy key'), { target: { value: 'priv-secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar e continuar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Testar credencial' }));
    expect(await screen.findByText('31 ms · sysName core-sw-01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar e continuar/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar agora/ }));
    expect(await screen.findByText('Primeira sincronização concluída')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Concluir/ }));
    expect(onDone).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
    expect(calls.find(([url]) => url.endsWith('/credentials'))?.[2]).toMatchObject({ purpose: 'READ', version: 'V3', username: 'netops' });
    expect(calls.find(([url]) => url.endsWith('/config'))?.[2]).toEqual({ enabled: true, port: 161, intervalMinutes: 15, timeoutMs: 5000, retries: 2, compatibilitySha1: false });
  });

  it('keeps Continuar disabled when the test fails with an authentication error', async () => {
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/settings/snmp-listeners') return receiver();
      if (url.endsWith('/test')) return { id: 't2', type: 'CREDENTIAL_TEST', status: 'PENDING', createdAt: '2026-11-23T10:00:00.000Z' };
      return { config: null, credentials: [{ id: 'c1', purpose: 'READ', version: 'V3', username: 'netops', configured: true }], latestSnapshot: null, jobs: [{ id: 't2', type: 'CREDENTIAL_TEST', status: 'FAILED', errorCode: 'SNMP_AUTHENTICATION_FAILED', createdAt: '2026-11-23T10:00:00.000Z' }], drifts: [], traps: [], setEnabled: false };
    });
    wrap(<SnmpSetupWizard deviceId="d1" deviceName="core-sw-01" close={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Usar a existente/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Testar credencial' }));
    expect(await screen.findByText('Falha de autenticação')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continuar/ })).toBeDisabled();
  });
});

describe('Fleet attention: Não configurado', () => {
  const summary = { devices: { total: 2, configured: 1, enabled: 1, disabled: 0, notConfigured: 1 }, polling: { byStatus: {}, stale: 0 }, drift: { pending: 0, devicesWithPending: 0 }, attention: [{ deviceId: 'd9', name: 'access-sw-09', reason: 'NOT_CONFIGURED' }] };
  it('labels the reason and opens the wizard from Configurar for admins', async () => {
    mockedFetch.mockResolvedValue(summary);
    const configureDevice = vi.fn();
    wrap(<SnmpFleetSummaryView siteId="site-1" openDevice={() => undefined} openDrifts={() => undefined} configureDevice={configureDevice} />);
    const table = await screen.findByRole('region', { name: 'Equipamentos que precisam de atenção' });
    expect(within(table).getByText('Não configurado')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Configurar SNMP em access-sw-09' }));
    expect(configureDevice).toHaveBeenCalledWith('d9', 'access-sw-09');
  });
  it('has no Configurar button without the admin callback', async () => {
    mockedFetch.mockResolvedValue(summary);
    wrap(<SnmpFleetSummaryView siteId="site-1" openDevice={() => undefined} openDrifts={() => undefined} />);
    await screen.findByRole('region', { name: 'Equipamentos que precisam de atenção' });
    expect(screen.queryByRole('button', { name: /Configurar SNMP/ })).not.toBeInTheDocument();
  });
});
