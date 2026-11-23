import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import DiscoveryPage, { EnrollmentModal } from './discovery-page';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Lisboa' }, loading: false }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const mockedFetch = vi.mocked(apiFetch);
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const receiver = (v2cAllowed: boolean) => ({ listenAll: true, selectedInterfaceIds: [], interfaces: [{ id: 'eth0', instanceId: 'h', name: 'eth0', address: '10.0.0.5', internal: false, lastSeenAt: '2026-11-23T10:00:00.000Z' }], engineId: null, engineIdSource: null, trapPort: 162, v2cAllowed, refreshSeconds: 30 });
const form = { sourceAddress: '10.9.9.9', siteId: 'site-1', version: 'V3' as const, username: 'netops', community: '', authKey: '', privKey: '', authProtocol: 'SHA256', privProtocol: 'AES128', compatibilitySha1: false };

beforeEach(() => { mockedFetch.mockReset(); window.history.replaceState(null, '', '/descoberta'); });
afterEach(cleanup);

describe('SNMP pre-registration dialog (SNMP Phase 1 step 3)', () => {
  it('embeds the switch setup lines for the expected IP and hides v2c when an admin disabled it', async () => {
    mockedFetch.mockResolvedValue(receiver(false));
    wrap(<EnrollmentModal form={form} setForm={() => undefined} close={() => undefined} submit={async () => undefined} admin />);
    const dialog = screen.getByRole('dialog');
    // P0-1/L4: the setup panel is open in the dialog, not behind a closed <details>.
    expect(within(dialog).getByRole('heading', { name: 'Configurar o switch' })).toBeVisible();
    expect(dialog.querySelector('details')).toBeNull();
    expect(await within(dialog).findByRole('button', { name: 'Copiar endereço do recetor' })).toBeEnabled();
    expect(within(dialog).getByText('10.0.0.5', { selector: '.mono' })).toBeInTheDocument();
    // N-1: one plain hint per field.
    expect(within(dialog).getByLabelText(/^IP esperado/)).toHaveAccessibleDescription('O IP de origem das traps, normalmente o IP de gestão do equipamento.');
    expect(within(dialog).getByLabelText(/^Auth key/)).toHaveAccessibleDescription(/prova que a trap vem do switch/);
    expect(within(dialog).getByLabelText(/^Privacy key/)).toHaveAccessibleDescription(/cifra o conteúdo da trap/);
    expect(await within(dialog).findByText(/snmp-server host 10\.0\.0\.5 version 3 priv netops/)).toBeInTheDocument();
    expect(within(dialog).getByText(/O trap-source tem de ser o IP de gestão \(10\.9\.9\.9\)/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: /SNMPv2c/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /SNMPv3 \(authPriv\)/ })).toBeChecked();
  });

  it('offers v2c as a normal option after the recommended v3, with the trade-off note once chosen', async () => {
    mockedFetch.mockResolvedValue(receiver(true));
    const setForm = vi.fn();
    const { rerender } = wrap(<EnrollmentModal form={form} setForm={setForm} close={() => undefined} submit={async () => undefined} admin />);
    const v2c = await screen.findByRole('radio', { name: 'SNMPv2c' });
    expect(screen.getByRole('radio', { name: /SNMPv3 \(authPriv\)/ })).toBeChecked();
    fireEvent.click(v2c);
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ version: 'V2C' }));
    rerender(<QueryClientProvider client={new QueryClient()}><EnrollmentModal form={{ ...form, version: 'V2C' }} setForm={setForm} close={() => undefined} submit={async () => undefined} admin /></QueryClientProvider>);
    expect(await screen.findByText('SNMPv2c envia a community em texto simples e não cifra os dados. Use apenas em redes de gestão isoladas; prefira SNMPv3 (authPriv).', { selector: 'fieldset span' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Community TRAP/)).toHaveAttribute('minLength', '8');
    expect(screen.getByLabelText(/^Community TRAP/)).toHaveAccessibleDescription(/palavra-passe partilhada/);
    expect(screen.queryByText(/laborat/i)).not.toBeInTheDocument();
  });

  it('opens prefilled from the unknown-traps link (?preRegister=)', async () => {
    mockedFetch.mockImplementation(async (url: string) => url === '/api/v1/settings/snmp-listeners' ? receiver(false) : url.startsWith('/api/v1/snmp/discovery/enrollments') || url.includes('/results') ? [] : url === '/api/v1/settings/discovery' ? { methods: ['ICMP'], tcpPorts: [], reverseDns: false, intervalHours: 24, allowedCidrs: [] } : { items: [], total: 0, page: 1, totalPages: 1 });
    window.history.replaceState(null, '', '/descoberta?tab=snmp&preRegister=10.9.9.9');
    wrap(<DiscoveryPage />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Pré-registar equipamento SNMP')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('10.9.9.9')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('links the SNMP tab, the flow note and the empty Hosts descobertos list to SNMP → Traps desconhecidas (N-E)', async () => {
    mockedFetch.mockImplementation(async (url: string) => url === '/api/v1/settings/snmp-listeners' ? receiver(false) : url.startsWith('/api/v1/snmp/discovery/enrollments') || url.includes('/results') ? [] : url === '/api/v1/settings/discovery' ? { methods: ['ICMP'], tcpPorts: [], reverseDns: false, intervalHours: 24, allowedCidrs: [] } : { items: [], total: 0, page: 1, totalPages: 1 });
    window.history.replaceState(null, '', '/descoberta?tab=snmp');
    wrap(<DiscoveryPage />);
    await screen.findByText('Nenhum equipamento pré-registado enviou traps.', { exact: false });
    const links = screen.getAllByRole('link', { name: 'Ver em SNMP → Traps desconhecidas' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/snmp?view=unknown');
  });

  it('puts the Rede/SNMP switch in the page body as a select for narrow screens (N-D)', async () => {
    mockedFetch.mockImplementation(async (url: string) => url === '/api/v1/settings/snmp-listeners' ? receiver(false) : url.startsWith('/api/v1/snmp/discovery/enrollments') || url.includes('/results') ? [] : url === '/api/v1/settings/discovery' ? { methods: ['ICMP'], tcpPorts: [], reverseDns: false, intervalHours: 24, allowedCidrs: [] } : { items: [], total: 0, page: 1, totalPages: 1 });
    window.history.replaceState(null, '', '/descoberta');
    wrap(<DiscoveryPage />);
    const select = screen.getByRole('combobox', { name: 'Tipo de descoberta' });
    expect(select.closest('.narrow-view-switch')).not.toBeNull();
    expect(select).toHaveValue('network');
    fireEvent.change(select, { target: { value: 'snmp' } });
    expect(await screen.findByText('Nenhum equipamento pré-registado enviou traps.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Tipo de descoberta' })).toHaveValue('snmp');
  });
});
